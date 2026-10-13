const TradeJournal = require("../models/trade-journal");
const { httpError } = require("./http");
const { canAccessBot } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");

function tradeKeyOf({ account, symbol, side }) {
    return `${String(account || "").trim()}|${String(symbol || "").trim().toUpperCase()}|${String(side || "").trim().toUpperCase()}`;
}

function normalizeTags(tags) {
    if (tags == null) return [];
    const list = Array.isArray(tags) ? tags : String(tags).split(",");
    const cleaned = [];
    for (const raw of list) {
        const tag = String(raw || "").trim().slice(0, 30);
        if (!tag) continue;
        if (!cleaned.includes(tag)) cleaned.push(tag);
        if (cleaned.length >= 10) break;
    }
    return cleaned;
}

function serialize(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        tradeKey: doc.tradeKey,
        account: doc.account,
        symbol: doc.symbol,
        side: doc.side,
        body: doc.body,
        tags: doc.tags || [],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

async function assertAccountAccess(actor, account) {
    const name = String(account || "").trim();
    if (!name) throw httpError(400, "Thiếu account");
    if (!canAccessBot(actor, name, PERMISSIONS.POSITIONS_VIEW)) {
        throw httpError(403, "Không có quyền với bot này");
    }
    return name;
}

async function listNotes(actor, { account, symbol, side, tradeKey, limit = 50 } = {}) {
    const filter = { actorId: String(actor.id) };
    if (tradeKey) filter.tradeKey = String(tradeKey);
    else {
        if (account) {
            filter.account = await assertAccountAccess(actor, account);
        }
        if (symbol) filter.symbol = String(symbol).trim().toUpperCase();
        if (side) filter.side = String(side).trim().toUpperCase();
    }
    const rows = await TradeJournal.find(filter).sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, Number(limit) || 50))).lean();
    return { items: rows.map(serialize) };
}

async function createNote(actor, input = {}) {
    const account = await assertAccountAccess(actor, input.account);
    const symbol = String(input.symbol || "").trim().toUpperCase();
    const side = String(input.side || "").trim().toUpperCase();
    const body = String(input.body || "").trim();
    if (!symbol) throw httpError(400, "Thiếu symbol");
    if (side !== "LONG" && side !== "SHORT") throw httpError(400, "Side phải LONG hoặc SHORT");
    if (!body) throw httpError(400, "Thiếu nội dung");
    if (body.length > 2000) throw httpError(400, "Journal tối đa 2000 ký tự");
    const tags = normalizeTags(input.tags);
    const doc = await TradeJournal.create({
        actorId: String(actor.id),
        tradeKey: tradeKeyOf({ account, symbol, side }),
        account,
        symbol,
        side,
        body,
        tags,
    });
    return serialize(doc);
}

async function updateNote(actor, id, input = {}) {
    const doc = await TradeJournal.findById(id);
    if (!doc || String(doc.actorId) !== String(actor.id)) throw httpError(404, "Không tìm thấy ghi chú");
    await assertAccountAccess(actor, doc.account);
    if (input.body != null) {
        const body = String(input.body).trim();
        if (!body) throw httpError(400, "Thiếu nội dung");
        if (body.length > 2000) throw httpError(400, "Journal tối đa 2000 ký tự");
        doc.body = body;
    }
    if (input.tags != null) doc.tags = normalizeTags(input.tags);
    await doc.save();
    return serialize(doc);
}

async function deleteNote(actor, id) {
    const doc = await TradeJournal.findById(id);
    if (!doc || String(doc.actorId) !== String(actor.id)) throw httpError(404, "Không tìm thấy ghi chú");
    await assertAccountAccess(actor, doc.account);
    await TradeJournal.deleteOne({ _id: doc._id });
    return { ok: true, id: String(id) };
}

module.exports = {
    tradeKeyOf,
    listNotes,
    createNote,
    updateNote,
    deleteNote,
    normalizeTags,
};
