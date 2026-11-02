const crypto = require("crypto");
const RiskReservation = require("../models/risk-reservation");
const RiskAccountLock = require("../models/risk-account-lock");
const { getPolicyForAccount, enforceReady } = require("./risk-policy");
const { buildPortfolioSnapshot } = require("./risk-portfolio");
const { hashPayload, nowMs } = require("./provenance");
const { httpError } = require("./http");

const LEASE_MS = 60_000;
const LOCK_MS = 5_000;
const ACTIVE = new Set(["reserved", "submitted", "unknown", "partial"]);
const BINDABLE = new Set(["reserved", "observed", "submitted", "partial", "unknown"]);
const RELEASABLE = new Set(["reserved", "observed", "submitted", "partial", "filled"]);

/**
 * Quyết định transition public/reconcile — pure để regression test.
 */
function decideBindTransition(currentStatus, { status, reconcile = false } = {}) {
    if (currentStatus === "rejected") {
        return { ok: false, code: "risk_rejected", message: "Reservation đã rejected" };
    }
    if (currentStatus === "released" || currentStatus === "filled") {
        return { ok: true, nextStatus: currentStatus, touchOnly: true };
    }
    if (currentStatus === "unknown" && !reconcile) {
        return { ok: false, code: "risk_rejected", message: "Unknown reservation chỉ reconcile nội bộ" };
    }
    if (["submitted", "partial"].includes(currentStatus) && status && !reconcile) {
        return { ok: true, nextStatus: currentStatus, touchOnly: true };
    }
    if (!BINDABLE.has(currentStatus) && !reconcile) {
        return { ok: false, code: "conflict", message: `Không bind từ status ${currentStatus}` };
    }
    if (reconcile && status && ["submitted", "filled", "partial", "unknown", "released"].includes(status)) {
        return { ok: true, nextStatus: status };
    }
    if (currentStatus === "reserved" || currentStatus === "observed") {
        return { ok: true, nextStatus: "submitted" };
    }
    return { ok: true, nextStatus: currentStatus, touchOnly: true };
}

function decideReleaseTransition(currentStatus, { reconcile = false } = {}) {
    if (currentStatus === "released" || currentStatus === "rejected") {
        return { ok: true, nextStatus: currentStatus, touchOnly: true };
    }
    if (currentStatus === "unknown" && !reconcile) {
        return { ok: false, code: "risk_rejected", message: "Không giải phóng reservation unknown — cần reconcile" };
    }
    if (["submitted", "partial", "filled"].includes(currentStatus) && !reconcile) {
        return { ok: false, code: "risk_rejected", message: "Không giải phóng submitted/partial từ client — cần reconcile sàn" };
    }
    if (!RELEASABLE.has(currentStatus) && currentStatus !== "unknown" && !reconcile) {
        return { ok: false, code: "conflict", message: `Không release từ status ${currentStatus}` };
    }
    return { ok: true, nextStatus: "released" };
}

/**
 * Soft lock chung web/bot (collection web_risk_account_locks).
 * Không throw lỗi hạ tầng Mongo — trả { ok, reason, result }.
 * Atomic reservation+lock vẫn chưa nghiệm thu trước enforce.
 */
function decideInfraOutcome({ mode, reason, reservation = null } = {}) {
    const msg = String(reason || "infra_error");
    if (mode === "enforce") {
        return {
            allowed: false,
            reason: msg,
            code: "risk_rejected",
            reservation: reservation || null,
            fenceWarning: msg,
            observedOnly: false,
        };
    }
    return {
        allowed: true,
        reason: `observe_continue:${msg}`,
        observedOnly: true,
        reservation: reservation || null,
        fenceWarning: msg,
    };
}

function decideFenceAfterWrite({ mode, reason, priorResult } = {}) {
    const msg = String(reason || "lock_fenced_after");
    if (priorResult && priorResult.allowed === false) {
        return { ...priorResult, fenceWarning: msg };
    }
    const enforce = mode === "enforce" || priorResult?.mode === "enforce" || priorResult?.policy?.mode === "enforce";
    if (enforce) {
        return {
            ...priorResult,
            allowed: false,
            reason: msg,
            code: "risk_rejected",
            mode: "enforce",
            fenceWarning: msg,
            // giữ reservation / reservationId để reconcile
        };
    }
    return {
        ...priorResult,
        allowed: true,
        reason: priorResult?.reason || `observe_continue:${msg}`,
        fenceWarning: msg,
        observedOnly: true,
    };
}

function effectivePolicyMode(policy) {
    let mode = policy?.mode || "observe";
    if (!enforceReady()) mode = "observe";
    return mode;
}

async function withAccountLock(account, fn) {
    const token = crypto.randomUUID();
    try {
        await RiskAccountLock.updateOne(
            { account },
            { $setOnInsert: { account, leaseOwner: null, leaseUntil: null, fence: 0 } },
            { upsert: true }
        );
    } catch (error) {
        return { ok: false, reason: `lock_upsert_error:${error.message}` };
    }

    let acquired = null;
    try {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            acquired = await RiskAccountLock.findOneAndUpdate(
                {
                    account,
                    $or: [
                        { leaseUntil: null },
                        { leaseUntil: { $lte: new Date() } },
                    ],
                },
                {
                    $set: {
                        leaseOwner: token,
                        leaseUntil: new Date(Date.now() + LOCK_MS),
                    },
                    $inc: { fence: 1 },
                },
                { new: true }
            );
            if (acquired?.leaseOwner === token) break;
            await new Promise((r) => setTimeout(r, 25 + attempt * 15));
            acquired = null;
        }
    } catch (error) {
        return { ok: false, reason: `lock_acquire_error:${error.message}` };
    }

    if (!acquired || acquired.leaseOwner !== token) {
        return { ok: false, reason: "lock_busy" };
    }
    const fence = acquired.fence;
    const renew = async () => {
        try {
            const row = await RiskAccountLock.findOneAndUpdate(
                { account, leaseOwner: token, fence },
                { $set: { leaseUntil: new Date(Date.now() + LOCK_MS) } },
                { new: true }
            );
            if (!row || row.leaseOwner !== token) {
                return { ok: false, reason: "lock_fenced" };
            }
            return { ok: true, row };
        } catch (error) {
            return { ok: false, reason: `lock_renew_error:${error.message}` };
        }
    };
    try {
        let still;
        try {
            still = await RiskAccountLock.findOne({ account, leaseOwner: token, fence }).lean();
        } catch (error) {
            return { ok: false, reason: `lock_read_error:${error.message}` };
        }
        if (!still) return { ok: false, reason: "lock_fenced" };

        const out = await fn({ token, fence, renew, lockMs: LOCK_MS });

        let after;
        try {
            after = await RiskAccountLock.findOne({ account, leaseOwner: token, fence }).lean();
        } catch (error) {
            return { ok: false, reason: `lock_read_after_error:${error.message}`, result: out };
        }
        if (!after) {
            return { ok: false, reason: "lock_fenced_after", result: out };
        }
        return { ok: true, result: out };
    } catch (error) {
        return { ok: false, reason: `lock_fn_error:${error.message}` };
    } finally {
        try {
            await RiskAccountLock.updateOne(
                { account, leaseOwner: token, fence },
                { $set: { leaseOwner: null, leaseUntil: null } }
            );
        } catch {
            /* release best-effort */
        }
    }
}

async function getReservation(reservationId) {
    return RiskReservation.findOne({ reservationId: String(reservationId || "") }).lean();
}

function publicReservation(doc) {
    if (!doc) return null;
    return {
        reservationId: doc.reservationId,
        account: doc.account,
        env: doc.env,
        producer: doc.producer,
        action: doc.action,
        symbol: doc.symbol,
        side: doc.side,
        positionSide: doc.positionSide,
        notionalNeed: doc.notionalNeed,
        riskNeed: doc.riskNeed,
        policyId: doc.policyId,
        policyRevision: doc.policyRevision,
        policyMode: doc.policyMode,
        requestId: doc.requestId,
        clientOrderId: doc.clientOrderId,
        payloadHash: doc.payloadHash,
        status: doc.status,
        exchangeOrderId: doc.exchangeOrderId || null,
        leaseUntil: doc.leaseUntil,
        reason: doc.reason || null,
        book: doc.book || "live",
        createdAt: doc.createdAt,
    };
}

async function loadActiveReservations(account) {
    return RiskReservation.find({
        account: String(account),
        status: { $in: [...ACTIVE] },
    }).lean();
}

function evaluateLimits(policy, snapshot, need) {
    const limits = policy?.limits || {};
    const reasons = [];
    if (limits.pauseNewEntries === true) {
        reasons.push({ code: "pause_new_entries", detail: "Policy pause new entries" });
    }
    const projectedGross = (snapshot.gross || 0) + (snapshot.pendingEntryNotional || 0)
        + (snapshot.reservedNotional || 0) + (need.notionalNeed || 0);
    if (limits.maxGrossNotional != null && projectedGross > Number(limits.maxGrossNotional)) {
        reasons.push({
            code: "max_gross",
            detail: `projectedGross ${projectedGross} > ${limits.maxGrossNotional}`,
        });
    }
    if (limits.maxOpenPositions != null
        && (snapshot.openPositions || 0) >= Number(limits.maxOpenPositions)
        && (need.quantity == null || Number(need.quantity) > 0)) {
        reasons.push({
            code: "max_open_positions",
            detail: `open ${snapshot.openPositions} >= ${limits.maxOpenPositions}`,
        });
    }
    if (limits.maxRiskAtStop != null && need.riskNeed != null) {
        const projectedRisk = (snapshot.coveredRiskAtStop || 0) + Number(need.riskNeed);
        if (projectedRisk > Number(limits.maxRiskAtStop)) {
            reasons.push({
                code: "max_risk_at_stop",
                detail: `projectedRisk ${projectedRisk} > ${limits.maxRiskAtStop}`,
            });
        }
    }
    if (limits.maxDailyLoss != null && snapshot.dailyLoss != null
        && snapshot.dailyLossQuality === "fresh"
        && snapshot.dailyLoss >= Number(limits.maxDailyLoss)) {
        reasons.push({ code: "daily_loss", detail: `dailyLoss ${snapshot.dailyLoss}` });
    }
    if (limits.maxSymbolNotional != null && need.symbol) {
        const row = (snapshot.bySymbol || []).find((s) => s.symbol === String(need.symbol).toUpperCase());
        const sym = (row?.notional || 0) + (need.notionalNeed || 0);
        if (sym > Number(limits.maxSymbolNotional)) {
            reasons.push({ code: "max_symbol", detail: `${need.symbol} ${sym}` });
        }
    }
    return reasons;
}

/**
 * Atomic-ish reserve: check idempotency, evaluate policy, insert reservation.
 * Default mode observe → status observed, allowed true.
 * Enforce + breach → reject. Store unavailable + enforce → block increase.
 */
async function reserveBudget({
    account,
    env,
    producer,
    producerVersion,
    action,
    symbol,
    side,
    positionSide,
    notionalNeed,
    riskNeed,
    quantity,
    requestId,
    clientOrderId,
    idempotencyKey,
    payload,
    book = "live",
    positions = [],
    wallet = null,
    openOrders = [],
    storeAvailable = true,
} = {}) {
    const username = String(account || "").trim();
    if (!username) throw httpError(400, "Thiếu account");

    const payloadHash = hashPayload(payload || {
        action, symbol, side, positionSide, quantity, notionalNeed, riskNeed, book,
    });

    if (idempotencyKey) {
        const existing = await RiskReservation.findOne({
            account: username,
            idempotencyKey: String(idempotencyKey),
        }).lean();
        if (existing) {
            if (existing.payloadHash !== payloadHash) {
                throw httpError(409, "Idempotency key khác payload", { code: "conflict" });
            }
            return { allowed: existing.status !== "rejected", duplicate: true, reservation: publicReservation(existing) };
        }
    }

    if (!storeAvailable) {
        const policy = await getPolicyForAccount(username).catch(() => null);
        if (policy?.mode === "enforce") {
            return {
                allowed: false,
                reservation: null,
                reason: "reservation_store_unavailable",
                code: "risk_rejected",
            };
        }
        return {
            allowed: true,
            reservation: null,
            reason: "store_unavailable_observe",
            observedOnly: true,
        };
    }

    // renew trước ghi giảm cửa sổ mất lease; atomic reservation+lock **chưa nghiệm thu** trước enforce.
    let locked;
    try {
        locked = await withAccountLock(username, async (lockCtx = {}) => {
        if (typeof lockCtx.renew === "function") {
            const renewed = await lockCtx.renew();
            if (renewed && renewed.ok === false) {
                // mode chưa biết — trả sentinel để tầng ngoài map observe/enforce
                return { __lockPreempt: true, reason: renewed.reason };
            }
        }
        const policy = await getPolicyForAccount(username);
        const mode = effectivePolicyMode(policy);
        const active = await loadActiveReservations(username);
        const snapshot = buildPortfolioSnapshot({
            username,
            positions,
            wallet,
            openOrders,
            reservations: active,
        });

        if (mode === "enforce" && snapshot.provenance?.quality === "missing") {
            return {
                allowed: false,
                code: "data_unavailable",
                reason: "risk_data_missing",
                snapshot,
                policy,
            };
        }

        const need = {
            notionalNeed: Number(notionalNeed) || 0,
            riskNeed: riskNeed != null ? Number(riskNeed) : null,
            quantity,
            symbol,
            notionalIncomplete: !(Number(notionalNeed) > 0),
        };
        if (mode === "enforce" && need.notionalIncomplete) {
            return {
                allowed: false,
                code: "data_unavailable",
                reason: "notional_need_missing",
                snapshot,
                policy,
            };
        }
        const breaches = policy ? evaluateLimits(policy, snapshot, need) : [];

        const reservationId = crypto.randomUUID();
        const leaseUntil = new Date(nowMs() + LEASE_MS);

        if (mode === "enforce" && breaches.length) {
            const doc = await RiskReservation.create({
                reservationId,
                account: username,
                env,
                producer: producer || "web",
                producerVersion,
                action,
                symbol: symbol ? String(symbol).toUpperCase() : undefined,
                side,
                positionSide,
                notionalNeed: need.notionalNeed,
                riskNeed: need.riskNeed,
                quantity: quantity != null ? String(quantity) : undefined,
                policyId: policy?.policyId,
                policyRevision: policy?.revision,
                policyMode: mode,
                requestId,
                clientOrderId,
                payloadHash,
                idempotencyKey: idempotencyKey || undefined,
                status: "rejected",
                leaseUntil,
                reason: breaches.map((b) => b.code).join(","),
                book,
            });
            return {
                allowed: false,
                code: "risk_rejected",
                reason: breaches[0].detail,
                breaches,
                reservation: publicReservation(doc),
                snapshot,
                policy,
            };
        }

        const status = mode === "enforce" ? "reserved" : "observed";
        if (typeof lockCtx.renew === "function") {
            const renewed = await lockCtx.renew();
            if (renewed && renewed.ok === false) {
                if (mode === "enforce") {
                    return {
                        allowed: false,
                        reason: renewed.reason || "lock_fenced",
                        code: "risk_rejected",
                        mode,
                        policy,
                    };
                }
                return {
                    allowed: true,
                    reason: `observe_continue:${renewed.reason || "lock_fenced"}`,
                    observedOnly: true,
                    mode,
                    policy,
                };
            }
        }
        let doc;
        try {
            doc = await RiskReservation.create({
            reservationId,
            account: username,
            env,
            producer: producer || "web",
            producerVersion,
            action,
            symbol: symbol ? String(symbol).toUpperCase() : undefined,
            side,
            positionSide,
            notionalNeed: need.notionalNeed,
            riskNeed: need.riskNeed,
            quantity: quantity != null ? String(quantity) : undefined,
            policyId: policy?.policyId,
            policyRevision: policy?.revision,
            policyMode: mode,
            requestId,
            clientOrderId,
            payloadHash,
            idempotencyKey: idempotencyKey || undefined,
            status,
            leaseUntil,
            reason: breaches.length ? `observe:${breaches.map((b) => b.code).join(",")}` : null,
            book,
        });
        } catch (error) {
            if (mode === "enforce") {
                return {
                    allowed: false,
                    reason: `reservation_write_error:${error.message}`,
                    code: "risk_rejected",
                    mode,
                    policy,
                };
            }
            return {
                allowed: true,
                reason: `reservation_write_skip_observe:${error.message}`,
                observedOnly: true,
                mode,
                policy,
            };
        }

        return {
            allowed: true,
            reservation: publicReservation(doc),
            breaches: mode === "observe" ? breaches : [],
            snapshot,
            policy,
            mode,
            observedOnly: mode !== "enforce",
        };
    });
    } catch (error) {
        locked = { ok: false, reason: `lock_throw:${error.message}` };
    }

    if (!locked || !locked.ok) {
        const reason = locked?.reason || "lock_busy";
        const prior = locked?.result;
        if (prior && prior.__lockPreempt) {
            const policy = await getPolicyForAccount(username).catch(() => null);
            return decideInfraOutcome({
                mode: effectivePolicyMode(policy),
                reason: prior.reason || reason,
            });
        }
        if (prior && typeof prior === "object" && "allowed" in prior) {
            return decideFenceAfterWrite({
                mode: prior.mode || effectivePolicyMode(prior.policy),
                reason,
                priorResult: prior,
            });
        }
        const policy = await getPolicyForAccount(username).catch(() => null);
        return decideInfraOutcome({
            mode: effectivePolicyMode(policy),
            reason,
            reservation: prior?.reservation || null,
        });
    }

    if (locked.result && locked.result.__lockPreempt) {
        const policy = await getPolicyForAccount(username).catch(() => null);
        return decideInfraOutcome({
            mode: effectivePolicyMode(policy),
            reason: locked.result.reason || "lock_fenced",
        });
    }
    return locked.result;
}

/**
 * Bind sau submit.
 * Client/public: chỉ reserved|observed → submitted (kèm requestId). Không nhận status tùy ý.
 * Unknown / submitted / partial → chỉ internal reconcile (opts.reconcile=true).
 */
async function bindReservation(reservationId, {
    requestId,
    clientOrderId,
    exchangeOrderId,
    status,
} = {}, opts = {}) {
    const reconcile = opts.reconcile === true;
    const doc = await RiskReservation.findOne({ reservationId: String(reservationId || "") });
    if (!doc) throw httpError(404, "Không tìm thấy reservation");

    const decision = decideBindTransition(doc.status, { status, reconcile });
    if (!decision.ok) {
        throw httpError(409, decision.message, { code: decision.code });
    }

    if (requestId) doc.requestId = String(requestId);
    if (clientOrderId) doc.clientOrderId = String(clientOrderId);
    if (exchangeOrderId) doc.exchangeOrderId = String(exchangeOrderId);

    if (!decision.touchOnly && decision.nextStatus) {
        doc.status = decision.nextStatus;
    }
    if (reconcile && decision.nextStatus === "unknown") {
        doc.leaseUntil = new Date(nowMs() + LEASE_MS * 10);
    }
    await doc.save();
    return publicReservation(doc);
}

/**
 * Release.
 * Public: chỉ reserved|observed.
 * submitted/partial/unknown: chỉ reconcile nội bộ.
 */
async function releaseReservation(reservationId, {
    status = "released",
} = {}, opts = {}) {
    const reconcile = opts.reconcile === true;
    const doc = await RiskReservation.findOne({ reservationId: String(reservationId || "") });
    if (!doc) throw httpError(404, "Không tìm thấy reservation");

    const decision = decideReleaseTransition(doc.status, { reconcile });
    if (!decision.ok) {
        throw httpError(409, decision.message, { code: decision.code });
    }
    if (decision.touchOnly) return publicReservation(doc);

    doc.status = "released";
    doc.reason = reconcile ? (doc.reason || "internal_reconcile_release") : "client_release_unused";
    await doc.save();
    return publicReservation(doc);
}

/** Đánh dấu unknown sau timeout — chỉ nội bộ. */
async function markReservationUnknown(reservationId, meta = {}) {
    return bindReservation(reservationId, {
        ...meta,
        status: "unknown",
    }, { reconcile: true });
}

async function expireIdleLeases(account) {
    const now = new Date();
    // Chỉ release reserved/observed hết lease — không đụng unknown/submitted
    const res = await RiskReservation.updateMany(
        {
            account: String(account),
            status: { $in: ["reserved", "observed"] },
            leaseUntil: { $lt: now },
            exchangeOrderId: null,
        },
        { $set: { status: "released", reason: "lease_expired_unused" } }
    );
    return { modified: res.modifiedCount || 0 };
}

module.exports = {
    reserveBudget,
    bindReservation,
    releaseReservation,
    markReservationUnknown,
    expireIdleLeases,
    loadActiveReservations,
    getReservation,
    publicReservation,
    evaluateLimits,
    withAccountLock,
    decideBindTransition,
    decideReleaseTransition,
    decideInfraOutcome,
    decideFenceAfterWrite,
    effectivePolicyMode,
    LEASE_MS,
    LOCK_MS,
    ACTIVE,
};
