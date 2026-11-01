const TradePlan = require("../models/trade-plan");
const { httpError } = require("./http");
const { canAccessResource, PERMISSIONS } = require("../auth/access-control");
const UserAccount = require("../models/user-account");

function actorIdOf(actor) {
    return actor?.id || (actor?._id ? String(actor._id) : "");
}

function publicPlan(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        planRevision: doc.planRevision,
        state: doc.state,
        target: doc.target || {},
        thesis: doc.thesis || "",
        entryType: doc.entryType,
        entryPrice: doc.entryPrice ?? null,
        stopLoss: doc.stopLoss ?? null,
        takeProfits: doc.takeProfits || [],
        quantity: doc.quantity ?? null,
        riskBudget: doc.riskBudget ?? null,
        timeframe: doc.timeframe || "15m",
        signalEventId: doc.signalEventId || null,
        setupId: doc.setupId || null,
        sourceSnapshot: doc.sourceSnapshot || null,
        expiresAt: doc.expiresAt || null,
        lastPreviewId: doc.lastPreviewId || null,
        lastPreviewHash: doc.lastPreviewHash || null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

async function assertAccountScope(actor, username) {
    if (!username) return;
    const bot = await UserAccount.findOne({ username }).select("username ownerUserId visibility active").lean();
    if (!bot) throw httpError(404, "Không tìm thấy tài khoản");
    if (!canAccessResource(actor, PERMISSIONS.POSITIONS_VIEW, bot)
        && !canAccessResource(actor, PERMISSIONS.ORDERS_VIEW, bot)
        && !canAccessResource(actor, PERMISSIONS.ORDERS_CREATE, bot)
        && !canAccessResource(actor, PERMISSIONS.POSITIONS_OPEN, bot)) {
        throw httpError(403, "Không có quyền với tài khoản này");
    }
}

function normalizeTarget(raw = {}) {
    const symbol = String(raw.symbol || raw.instrumentId || "").trim().toUpperCase();
    const instrumentId = String(raw.instrumentId || symbol).trim().toUpperCase() || null;
    return {
        username: raw.username ? String(raw.username).trim() : undefined,
        env: raw.env ? String(raw.env).trim() : undefined,
        exchange: raw.exchange ? String(raw.exchange).trim().toLowerCase() : "binance",
        marketType: raw.marketType || "usdt_perp_linear",
        instrumentId,
        symbol: symbol || instrumentId,
        side: raw.side ? String(raw.side).toUpperCase() : undefined,
        positionSide: raw.positionSide ? String(raw.positionSide).toUpperCase() : undefined,
        positionIdx: raw.positionIdx != null && raw.positionIdx !== "" ? Number(raw.positionIdx) : undefined,
    };
}

async function createPlan(actor, body = {}) {
    const actorId = actorIdOf(actor);
    if (!actorId) throw httpError(401, "Thiếu actor");
    const target = normalizeTarget(body.target || body);
    if (!target.symbol) throw httpError(400, "Thiếu symbol/instrumentId");
    await assertAccountScope(actor, target.username);

    const ttlMs = Number(body.ttlMs) > 0 ? Number(body.ttlMs) : 30 * 60 * 1000;
    const doc = await TradePlan.create({
        actorId,
        planRevision: 1,
        state: "draft",
        target,
        thesis: String(body.thesis || "").slice(0, 2000),
        entryType: String(body.entryType || "MARKET").toUpperCase(),
        entryPrice: body.entryPrice != null ? String(body.entryPrice) : undefined,
        stopLoss: body.stopLoss != null ? String(body.stopLoss) : undefined,
        takeProfits: Array.isArray(body.takeProfits)
            ? body.takeProfits.map(String).slice(0, 5)
            : (body.takeProfit != null ? [String(body.takeProfit)] : []),
        quantity: body.quantity != null ? String(body.quantity) : undefined,
        riskBudget: body.riskBudget != null ? String(body.riskBudget) : undefined,
        timeframe: body.timeframe || "15m",
        signalEventId: body.signalEventId || body.eventId || undefined,
        setupId: body.setupId || undefined,
        sourceSnapshot: body.sourceSnapshot || null,
        expiresAt: new Date(Date.now() + ttlMs),
    });
    return publicPlan(doc);
}

async function getPlan(actor, planId) {
    const actorId = actorIdOf(actor);
    const doc = await TradePlan.findById(String(planId || "")).lean();
    if (!doc || doc.actorId !== actorId) throw httpError(404, "Không tìm thấy plan");
    return publicPlan(doc);
}

async function listPlans(actor, query = {}) {
    const actorId = actorIdOf(actor);
    const filter = { actorId };
    if (query.state) filter.state = String(query.state);
    if (query.symbol) filter["target.symbol"] = String(query.symbol).toUpperCase();
    const rows = await TradePlan.find(filter).sort({ updatedAt: -1 }).limit(50).lean();
    return { plans: rows.map(publicPlan) };
}

async function patchPlan(actor, planId, body = {}) {
    const actorId = actorIdOf(actor);
    const doc = await TradePlan.findById(String(planId || ""));
    if (!doc || doc.actorId !== actorId) throw httpError(404, "Không tìm thấy plan");
    if (doc.state === "submitted" || doc.state === "cancelled") {
        throw httpError(409, "Plan đã khóa", { code: "source_changed" });
    }
    if (body.expectedRevision != null && Number(body.expectedRevision) !== doc.planRevision) {
        throw httpError(409, "Plan revision đã đổi", { code: "source_changed" });
    }

    if (body.target) {
        const target = normalizeTarget({ ...doc.target?.toObject?.() || doc.target, ...body.target });
        await assertAccountScope(actor, target.username);
        doc.target = target;
    }
    for (const key of ["thesis", "entryType", "entryPrice", "stopLoss", "quantity", "riskBudget", "timeframe", "signalEventId", "setupId"]) {
        if (body[key] !== undefined) {
            doc[key] = key === "thesis" ? String(body[key] || "").slice(0, 2000) : body[key];
        }
    }
    if (body.takeProfits !== undefined) {
        doc.takeProfits = Array.isArray(body.takeProfits) ? body.takeProfits.map(String).slice(0, 5) : [];
    }
    if (body.takeProfit !== undefined) {
        doc.takeProfits = body.takeProfit != null ? [String(body.takeProfit)] : [];
    }
    if (body.state && ["draft", "cancelled", "expired"].includes(body.state)) {
        doc.state = body.state;
    }
    // Chart drag / size / SL change invalidates preview binding
    doc.lastPreviewId = undefined;
    doc.lastPreviewHash = undefined;
    doc.planRevision += 1;
    doc.state = doc.state === "previewed" ? "draft" : doc.state;
    await doc.save();
    return publicPlan(doc);
}

async function bindPreview(actor, planId, preview) {
    const actorId = actorIdOf(actor);
    const doc = await TradePlan.findById(String(planId || ""));
    if (!doc || doc.actorId !== actorId) throw httpError(404, "Không tìm thấy plan");
    doc.lastPreviewId = preview.previewId;
    doc.lastPreviewHash = preview.payloadHash;
    doc.state = "previewed";
    await doc.save();
    return publicPlan(doc);
}

module.exports = {
    createPlan,
    getPlan,
    listPlans,
    patchPlan,
    bindPreview,
    publicPlan,
    actorIdOf,
};
