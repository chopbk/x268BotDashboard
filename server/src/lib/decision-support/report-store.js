const crypto = require("crypto");
const AiDecisionReport = require("../../models/ai-decision-report");

function makeSnapshotId(parts = {}) {
    const raw = JSON.stringify({
        scope: parts.scope,
        account: parts.account,
        symbol: parts.symbol,
        side: parts.side,
        asOf: parts.asOf,
        formula: parts.formulaVersion,
    });
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

async function saveReport(actor, payload) {
    const actorId = String(actor?.id || actor?._id || "");
    if (!actorId) throw new Error("Thiếu actor");
    const report = payload.report || {};
    const doc = await AiDecisionReport.create({
        actorId,
        scope: payload.scope,
        tradeKey: payload.tradeKey || null,
        account: payload.account || null,
        symbol: payload.symbol || null,
        side: payload.side || null,
        snapshotId: report.snapshotId || payload.snapshotId,
        asOf: report.asOf || payload.asOf,
        report,
        model: report.meta?.model || null,
        promptVersion: report.meta?.promptVersion || null,
        formulaVersion: report.meta?.formulaVersion || null,
        source: report.meta?.source || "rules",
        riskLevel: report.riskLevel || null,
    });
    return serialize(doc);
}

function serialize(doc) {
    if (!doc) return null;
    const row = typeof doc.toObject === "function" ? doc.toObject() : doc;
    return {
        id: String(row._id),
        actorId: row.actorId,
        scope: row.scope,
        tradeKey: row.tradeKey,
        account: row.account,
        symbol: row.symbol,
        side: row.side,
        snapshotId: row.snapshotId,
        asOf: row.asOf,
        report: row.report,
        riskLevel: row.riskLevel,
        source: row.source,
        createdAt: row.createdAt,
    };
}

async function listReports(actor, query = {}) {
    const actorId = String(actor?.id || actor?._id || "");
    const filter = { actorId };
    if (query.scope === "position" || query.scope === "account") filter.scope = query.scope;
    if (query.account) filter.account = String(query.account).trim();
    if (query.tradeKey) filter.tradeKey = String(query.tradeKey).trim();
    if (query.symbol) filter.symbol = String(query.symbol).trim().toUpperCase();
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
    const rows = await AiDecisionReport.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return { items: rows.map(serialize) };
}

async function latestAccountReport(actor, account = null) {
    const actorId = String(actor?.id || actor?._id || "");
    const filter = { actorId, scope: "account" };
    if (account) filter.account = String(account).trim();
    const row = await AiDecisionReport.findOne(filter).sort({ createdAt: -1 }).lean();
    return serialize(row);
}

module.exports = {
    makeSnapshotId,
    saveReport,
    listReports,
    latestAccountReport,
};
