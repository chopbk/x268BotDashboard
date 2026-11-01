const TerminalWorkspace = require("../models/terminal-workspace");
const { httpError } = require("./http");
const { actorIdOf } = require("./trade-plan");

const ALLOWED_TF = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]);

function publicWorkspace(doc) {
    if (!doc) return null;
    return {
        revision: doc.revision,
        layout: doc.layout || {},
        watchlist: doc.watchlist || [],
        timeframe: doc.timeframe || "15m",
        drawings: doc.drawings || [],
        updatedAt: doc.updatedAt,
    };
}

async function getWorkspace(actor) {
    const actorId = actorIdOf(actor);
    if (!actorId) throw httpError(401, "Thiếu actor");
    let doc = await TerminalWorkspace.findOne({ actorId }).lean();
    if (!doc) {
        doc = await TerminalWorkspace.create({ actorId });
        doc = doc.toObject ? doc.toObject() : doc;
    }
    return publicWorkspace(doc);
}

async function putWorkspace(actor, body = {}) {
    const actorId = actorIdOf(actor);
    if (!actorId) throw httpError(401, "Thiếu actor");
    let doc = await TerminalWorkspace.findOne({ actorId });
    if (!doc) doc = new TerminalWorkspace({ actorId });

    if (body.expectedRevision != null && Number(body.expectedRevision) !== doc.revision) {
        throw httpError(409, "Workspace revision đã đổi", { code: "source_changed" });
    }

    if (body.layout && typeof body.layout === "object") {
        doc.layout = {
            ...doc.layout?.toObject?.() || doc.layout || {},
            ...body.layout,
        };
    }
    if (Array.isArray(body.watchlist)) {
        doc.watchlist = body.watchlist.slice(0, 50).map((item) => ({
            exchange: item.exchange || "binance",
            marketType: item.marketType || "usdt_perp_linear",
            instrumentId: String(item.instrumentId || item.symbol || "").toUpperCase(),
            symbol: String(item.symbol || item.instrumentId || "").toUpperCase(),
        })).filter((item) => item.symbol);
    }
    if (body.timeframe && ALLOWED_TF.has(String(body.timeframe))) {
        doc.timeframe = String(body.timeframe);
    }
    if (Array.isArray(body.drawings)) {
        doc.drawings = body.drawings.slice(0, 200).map((d) => ({
            marketKey: String(d.marketKey || "").slice(0, 120),
            kind: ["hline", "trendline", "zone"].includes(d.kind) ? d.kind : "hline",
            points: Array.isArray(d.points) ? d.points.map(Number).filter(Number.isFinite).slice(0, 4) : [],
            label: d.label ? String(d.label).slice(0, 40) : undefined,
            color: d.color ? String(d.color).slice(0, 20) : undefined,
        }));
    }
    doc.revision += 1;
    await doc.save();
    return publicWorkspace(doc);
}

module.exports = {
    getWorkspace,
    putWorkspace,
    publicWorkspace,
    ALLOWED_TF,
};
