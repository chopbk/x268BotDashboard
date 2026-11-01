const crypto = require("crypto");
const TradingPreview = require("../models/trading-preview");
const { httpError } = require("./http");
const { checkTargetAccess } = require("./trading-bridge");
const { markQuoteOf } = require("./mark-prices");
const { envelope, quoteQuality, hashPayload, TTL, nowMs } = require("./provenance");
const { bindPreview, getPlan, actorIdOf } = require("./trade-plan");
const { getExchangeAdapter } = require("./exchanges/factory");
const UserAccount = require("../models/user-account");

const PREVIEW_TTL_MS = 30_000;

function publicPreview(doc) {
    if (!doc) return null;
    return {
        previewId: doc.previewId,
        planId: doc.planId || null,
        planRevision: doc.planRevision ?? null,
        payloadHash: doc.payloadHash,
        action: doc.action,
        target: doc.target,
        params: doc.params,
        quote: doc.quote,
        sizing: doc.sizing,
        risk: doc.risk,
        capability: doc.capability,
        provenance: doc.provenance,
        status: doc.status,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
    };
}

function buildPayloadHash({ action, target, params }) {
    return hashPayload({
        action,
        username: target?.username,
        env: target?.env || null,
        exchange: target?.exchange || null,
        instrumentId: target?.instrumentId || target?.symbol,
        symbol: target?.symbol,
        side: target?.side || params?.side,
        positionSide: target?.positionSide || params?.positionSide,
        quantity: params?.quantity ?? null,
        price: params?.price ?? null,
        triggerPrice: params?.triggerPrice ?? null,
        stopLoss: params?.stopLoss ?? null,
        takeProfit: params?.takeProfit ?? null,
        orderType: params?.orderType || params?.type || null,
    });
}

async function resolveCapability(username, symbol) {
    try {
        const account = await UserAccount.findOne({ username }).lean();
        if (!account) return { supported: false, reason: "account_missing", quality: "missing" };
        const adapter = getExchangeAdapter(account);
        const caps = {
            regularOrder: true,
            conditionalOrder: typeof adapter?.requireCapability === "function",
            bracketAtomic: false,
        };
        return {
            supported: true,
            exchange: adapter?.exchangeId || adapter?.id || account.exchange || "unknown",
            caps,
            bracketAtomic: false,
            protectionStates: ["entry_filled_protection_pending", "entry_filled_protection_failed"],
            quality: "partial",
            instrumentId: String(symbol || "").toUpperCase(),
        };
    } catch (error) {
        return {
            supported: false,
            reason: error.message || "unsupported_capability",
            quality: "unsupported",
            code: "unsupported_capability",
        };
    }
}

/**
 * Tạo preview — không đặt lệnh.
 */
async function createPreview(actor, body = {}) {
    const actorId = actorIdOf(actor);
    if (!actorId) throw httpError(401, "Thiếu actor");

    const action = String(body.action || "ORDER_CREATE").toUpperCase();
    if (!["ORDER_CREATE", "POSITION_OPEN"].includes(action)) {
        throw httpError(400, "Preview chỉ hỗ trợ ORDER_CREATE hoặc POSITION_OPEN");
    }

    const symbol = String(body.symbol || body.target?.symbol || "").trim().toUpperCase();
    const username = String(body.username || body.target?.username || "").trim();
    if (!username) throw httpError(400, "Thiếu username");
    if (!symbol) throw httpError(400, "Thiếu symbol");

    await checkTargetAccess(actor, username, action);

    let plan = null;
    if (body.planId) {
        plan = await getPlan(actor, body.planId);
        if (body.expectedPlanRevision != null
            && Number(body.expectedPlanRevision) !== Number(plan.planRevision)) {
            throw httpError(409, "Plan đã đổi — tạo preview lại", { code: "source_changed" });
        }
    }

    const quoteInfo = markQuoteOf(symbol);
    const receivedAt = quoteInfo?.receivedAt ?? nowMs();
    const quality = quoteInfo?.mark == null
        ? "missing"
        : quoteQuality(receivedAt, TTL.mark_quote_trading);
    if (quality === "missing") {
        throw httpError(503, "Thiếu mark quote", { code: "data_unavailable" });
    }
    if (quality === "stale" && body.allowStale !== true) {
        throw httpError(409, "Quote hết hạn / stale", { code: "preview_expired" });
    }

    const params = {
        side: body.side || body.params?.side,
        positionSide: body.positionSide || body.params?.positionSide || plan?.target?.positionSide,
        type: body.type || body.orderType || body.params?.type || plan?.entryType || "MARKET",
        orderType: body.orderType || body.type || plan?.entryType || "MARKET",
        quantity: body.quantity ?? body.params?.quantity ?? plan?.quantity,
        price: body.price ?? body.params?.price ?? plan?.entryPrice,
        triggerPrice: body.triggerPrice ?? body.params?.triggerPrice,
        stopLoss: body.stopLoss ?? body.params?.stopLoss ?? plan?.stopLoss,
        takeProfit: body.takeProfit ?? body.params?.takeProfit
            ?? (plan?.takeProfits?.[0] ?? null),
        reduceOnly: body.reduceOnly === true,
    };

    const target = {
        username,
        env: body.env || body.target?.env || plan?.target?.env,
        exchange: body.exchange || plan?.target?.exchange || "binance",
        marketType: body.marketType || plan?.target?.marketType || "usdt_perp_linear",
        instrumentId: body.instrumentId || plan?.target?.instrumentId || symbol,
        symbol,
        side: params.side,
        positionSide: params.positionSide,
    };

    const capability = await resolveCapability(username, symbol);
    if (capability.supported === false && capability.quality === "unsupported") {
        throw httpError(400, capability.reason || "Sàn không hỗ trợ", { code: "unsupported_capability" });
    }

    const qty = Number(params.quantity);
    const mark = Number(quoteInfo.mark);
    const entry = Number(params.price) > 0 ? Number(params.price) : mark;
    const stop = Number(params.stopLoss);
    const notional = Number.isFinite(qty) && Number.isFinite(entry) ? qty * entry : null;
    const sideSign = String(params.positionSide || params.side || "").includes("SHORT")
        || String(params.side).toUpperCase() === "SELL"
        ? -1
        : 1;
    let riskAtStop = null;
    if (Number.isFinite(qty) && Number.isFinite(entry) && Number.isFinite(stop) && stop > 0) {
        riskAtStop = Math.max(0, -sideSign * qty * (stop - entry));
    }

    const payloadHash = buildPayloadHash({ action, target, params });
    const previewId = crypto.randomUUID();
    const expiresAt = new Date(nowMs() + PREVIEW_TTL_MS);
    const quoteExpiresAt = receivedAt + TTL.mark_quote_trading;

    const provenance = envelope({
        source: "trading-preview",
        sourceAt: quoteInfo?.sourceAt ?? receivedAt,
        receivedAt,
        computedAt: nowMs(),
        quality: quality === "fresh" ? "fresh" : "stale",
        missingFields: riskAtStop == null ? ["riskAtStop"] : [],
        expiresAt: quoteExpiresAt,
        coverage: { previewTtlMs: PREVIEW_TTL_MS, quoteTtlMs: TTL.mark_quote_trading },
    });

    const doc = await TradingPreview.create({
        previewId,
        actorId,
        planId: plan?.id || body.planId || undefined,
        planRevision: plan?.planRevision,
        payloadHash,
        action,
        target,
        params,
        quote: {
            mark: String(quoteInfo.mark),
            source: "mark-prices",
            sourceAt: quoteInfo?.sourceAt ?? receivedAt,
            receivedAt,
            expiresAt: quoteExpiresAt,
            quality,
        },
        sizing: {
            quantity: params.quantity ?? null,
            notional,
            entryPrice: entry,
            feeRateHint: 0.0004,
            estimatedFee: notional != null ? Math.abs(notional) * 0.0004 : null,
        },
        risk: {
            stopLoss: params.stopLoss ?? null,
            takeProfit: params.takeProfit ?? null,
            riskAtStop,
            basis: "linear_usdt",
            incomplete: riskAtStop == null,
        },
        capability,
        provenance,
        status: "valid",
        expiresAt,
    });

    if (plan?.id) {
        await bindPreview(actor, plan.id, { previewId, payloadHash });
    }

    return publicPreview(doc);
}

/**
 * Kiểm tra preview còn hiệu lực trước submit.
 * Invalid khi hết hạn, quote stale, hoặc payload hash lệch.
 */
async function assertPreviewForSubmit(actor, { previewId, action, target, params }) {
    if (!previewId) return { required: false };
    const actorId = actorIdOf(actor);
    const doc = await TradingPreview.findOne({ previewId: String(previewId) }).lean();
    if (!doc || doc.actorId !== actorId) {
        throw httpError(409, "Preview không tồn tại", { code: "preview_expired" });
    }
    if (doc.status !== "valid" || new Date(doc.expiresAt).getTime() <= Date.now()) {
        throw httpError(409, "Preview hết hạn", { code: "preview_expired" });
    }

    const quoteInfo = markQuoteOf(doc.target?.symbol || target?.symbol);
    const q = quoteQuality(quoteInfo?.receivedAt ?? doc.quote?.receivedAt, TTL.mark_quote_trading);
    if (!quoteInfo?.mark || q === "stale" || q === "missing") {
        throw httpError(409, "Quote stale — tạo preview lại", { code: "preview_expired" });
    }

    const nextHash = buildPayloadHash({
        action: action || doc.action,
        target: {
            ...doc.target,
            ...(target || {}),
        },
        params: {
            ...doc.params,
            ...(params || {}),
        },
    });
    if (nextHash !== doc.payloadHash) {
        throw httpError(409, "Account/size/SL/giá đã đổi — preview invalid", { code: "source_changed" });
    }

    await TradingPreview.updateOne({ previewId: doc.previewId }, { $set: { status: "consumed" } });
    return { required: true, preview: publicPreview({ ...doc, status: "consumed" }) };
}

async function getPreview(actor, previewId) {
    const actorId = actorIdOf(actor);
    const doc = await TradingPreview.findOne({ previewId: String(previewId || "") }).lean();
    if (!doc || doc.actorId !== actorId) throw httpError(404, "Không tìm thấy preview");
    const expired = doc.status !== "valid" || new Date(doc.expiresAt).getTime() <= Date.now();
    return publicPreview({ ...doc, status: expired && doc.status === "valid" ? "expired" : doc.status });
}

module.exports = {
    createPreview,
    assertPreviewForSubmit,
    getPreview,
    publicPreview,
    buildPayloadHash,
    PREVIEW_TTL_MS,
};
