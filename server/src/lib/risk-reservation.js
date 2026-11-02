const crypto = require("crypto");
const RiskReservation = require("../models/risk-reservation");
const RiskAccountLock = require("../models/risk-account-lock");
const { getPolicyForAccount } = require("./risk-policy");
const { buildPortfolioSnapshot } = require("./risk-portfolio");
const { hashPayload, nowMs } = require("./provenance");
const { httpError } = require("./http");

const LEASE_MS = 60_000;
const LOCK_MS = 5_000;
const ACTIVE = new Set(["reserved", "submitted", "unknown", "partial"]);
const BINDABLE = new Set(["reserved", "observed", "submitted", "partial", "unknown"]);
const RELEASABLE = new Set(["reserved", "observed", "submitted", "partial", "filled"]);

async function withAccountLock(account, fn) {
    const token = crypto.randomUUID();
    const now = new Date();
    await RiskAccountLock.updateOne(
        { account },
        { $setOnInsert: { account, leaseOwner: null, leaseUntil: null } },
        { upsert: true }
    );
    let acquired = null;
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
            },
            { new: true }
        );
        if (acquired?.leaseOwner === token) break;
        await new Promise((r) => setTimeout(r, 25 + attempt * 15));
        acquired = null;
    }
    if (!acquired || acquired.leaseOwner !== token) {
        throw httpError(409, "Risk reservation lock bận — thử lại", { code: "risk_rejected" });
    }
    try {
        return await fn();
    } finally {
        await RiskAccountLock.updateOne(
            { account, leaseOwner: token },
            { $set: { leaseOwner: null, leaseUntil: null } }
        );
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

    return withAccountLock(username, async () => {
        const policy = await getPolicyForAccount(username);
        const mode = policy?.mode || "observe";
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
            status,
            leaseUntil,
            reason: breaches.length ? `observe:${breaches.map((b) => b.code).join(",")}` : null,
            book,
        });

        return {
            allowed: true,
            reservation: publicReservation(doc),
            breaches: mode === "observe" ? breaches : [],
            snapshot,
            policy,
            observedOnly: mode !== "enforce",
        };
    });
}

async function bindReservation(reservationId, { requestId, clientOrderId, exchangeOrderId, status } = {}) {
    const doc = await RiskReservation.findOne({ reservationId: String(reservationId || "") });
    if (!doc) throw httpError(404, "Không tìm thấy reservation");
    if (!BINDABLE.has(doc.status) && doc.status !== "rejected") {
        throw httpError(409, `Không bind từ status ${doc.status}`, { code: "conflict" });
    }
    if (doc.status === "rejected") {
        throw httpError(409, "Reservation đã rejected", { code: "risk_rejected" });
    }
    if (requestId) doc.requestId = String(requestId);
    if (clientOrderId) doc.clientOrderId = String(clientOrderId);
    if (exchangeOrderId) doc.exchangeOrderId = String(exchangeOrderId);
    const next = status && ["submitted", "filled", "partial", "unknown"].includes(status)
        ? status
        : (doc.status === "reserved" || doc.status === "observed" ? "submitted" : doc.status);
    doc.status = next;
    if (doc.status === "unknown") {
        doc.leaseUntil = new Date(nowMs() + LEASE_MS * 10);
    }
    await doc.save();
    return publicReservation(doc);
}

/**
 * Release — không nhận force từ client. Unknown chỉ reconcile nội bộ (allowUnknownRelease).
 */
async function releaseReservation(reservationId, {
    status = "released",
    allowUnknownRelease = false,
} = {}) {
    const doc = await RiskReservation.findOne({ reservationId: String(reservationId || "") });
    if (!doc) throw httpError(404, "Không tìm thấy reservation");
    if (doc.status === "unknown" && !allowUnknownRelease) {
        throw httpError(409, "Không giải phóng reservation unknown — cần reconcile", {
            code: "risk_rejected",
        });
    }
    if (doc.status === "released" || doc.status === "rejected") {
        return publicReservation(doc);
    }
    if (!RELEASABLE.has(doc.status) && doc.status !== "unknown") {
        throw httpError(409, `Không release từ status ${doc.status}`, { code: "conflict" });
    }
    doc.status = status === "released" ? "released" : "released";
    await doc.save();
    return publicReservation(doc);
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
    expireIdleLeases,
    loadActiveReservations,
    getReservation,
    publicReservation,
    evaluateLimits,
    withAccountLock,
    LEASE_MS,
    ACTIVE,
};
