/**
 * Durable claim trước side-effect — terminal-r1-gaps B3.
 * Chỉ winner của unique (actorUserId, idempotencyKey) được execute.
 */
const TradingReceipt = require("../models/trading-receipt");
const { httpError } = require("./http");
const { hashPayload } = require("./provenance");
const {
    assertReceiptStatus,
    isTerminalReceiptStatus,
} = require("./trading-receipt-status");

const IN_FLIGHT = new Set(["claimed", "submitted"]);

function isInFlightStatus(status) {
    return IN_FLIGHT.has(String(status || ""));
}

function buildTradingPayloadHash({ action, target = {}, params = {} } = {}) {
    return hashPayload({
        action: String(action || ""),
        username: String(target.username || ""),
        env: String(target.env || ""),
        symbol: String(target.symbol || "").toUpperCase(),
        positionSide: String(target.positionSide || "").toUpperCase(),
        params,
    });
}

/**
 * So khớp replay vs conflict — pure.
 * @returns {{ kind: "replay"|"conflict", message?: string }}
 */
function classifyClaimReplay(existing, { payloadHash, action } = {}) {
    if (!existing) return { kind: "conflict", message: "Không tìm thấy receipt trùng key" };
    if (existing.payloadHash && payloadHash && existing.payloadHash !== payloadHash) {
        return { kind: "conflict", message: "Idempotency key khác payload" };
    }
    if (!existing.payloadHash && action && existing.action && existing.action !== action) {
        return { kind: "conflict", message: "Idempotency key khác action (legacy receipt)" };
    }
    return { kind: "replay" };
}

async function claimTradingReceipt({
    requestId,
    idempotencyKey,
    action,
    target,
    payloadHash,
    actorUserId,
    actorUsername,
    expiresAt,
}) {
    try {
        const doc = await TradingReceipt.create({
            requestId,
            idempotencyKey,
            action,
            target: {
                username: target?.username,
                env: target?.env,
                symbol: target?.symbol,
                positionSide: target?.positionSide,
            },
            status: "claimed",
            payloadHash,
            actorUserId,
            actorUsername: actorUsername || "",
            expiresAt,
            claimedAt: new Date(),
        });
        return { claimed: true, receipt: doc.toObject ? doc.toObject() : doc };
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const existing = await TradingReceipt.findOne({
            actorUserId: String(actorUserId || ""),
            idempotencyKey: String(idempotencyKey),
        }).lean();
        if (!existing) {
            // Conflict trên requestId hiếm — tìm theo requestId
            const byReq = await TradingReceipt.findOne({ requestId: String(requestId) }).lean();
            if (byReq) {
                const cls = classifyClaimReplay(byReq, { payloadHash, action });
                if (cls.kind === "conflict") {
                    throw httpError(409, cls.message, { code: "conflict" });
                }
                return { claimed: false, duplicate: true, receipt: byReq };
            }
            throw httpError(409, "Idempotency conflict — không đọc được receipt", { code: "conflict" });
        }
        const cls = classifyClaimReplay(existing, { payloadHash, action });
        if (cls.kind === "conflict") {
            throw httpError(409, cls.message, { code: "conflict" });
        }
        return { claimed: false, duplicate: true, receipt: existing };
    }
}

async function markReceiptSubmitted(requestId) {
    return TradingReceipt.findOneAndUpdate(
        { requestId: String(requestId), status: "claimed" },
        { $set: { status: "submitted", submittedAt: new Date() } },
        { new: true }
    ).lean();
}

async function finalizeTradingReceipt(requestId, {
    status,
    result = null,
    error = null,
    exchangeIds = [],
} = {}) {
    const next = assertReceiptStatus(status);
    const set = {
        status: next,
        result,
        error,
        exchangeIds: Array.isArray(exchangeIds) ? exchangeIds.filter(Boolean).map(String) : [],
    };
    if (isTerminalReceiptStatus(next) || next === "unknown") {
        set.completedAt = new Date();
    }
    if (next !== "claimed") {
        set.submittedAt = new Date();
    }
    return TradingReceipt.findOneAndUpdate(
        { requestId: String(requestId) },
        { $set: set },
        { new: true }
    ).lean();
}

module.exports = {
    IN_FLIGHT,
    isInFlightStatus,
    buildTradingPayloadHash,
    classifyClaimReplay,
    claimTradingReceipt,
    markReceiptSubmitted,
    finalizeTradingReceipt,
};
