const crypto = require("crypto");
const ResearchTrack = require("../models/research-track");
const InboxItem = require("../models/inbox-item");
const { httpError } = require("./http");
const { nowMs } = require("./provenance");

function actorIdOf(actor) {
    return actor?.id || (actor?._id ? String(actor._id) : "");
}

function publicTrack(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        title: doc.title,
        note: doc.note || "",
        status: doc.status,
        terminalReason: doc.terminalReason || null,
        source: doc.source,
        baseline: doc.baseline,
        lastObservation: doc.lastObservation,
        dataQuality: doc.dataQuality,
        expiresAt: doc.expiresAt,
        revision: doc.revision,
        lastCheckedAt: doc.lastCheckedAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

function publicInbox(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        kind: doc.kind,
        title: doc.title,
        body: doc.body,
        resourceType: doc.resourceType,
        resourceId: doc.resourceId,
        occurredAt: doc.occurredAt,
        detectedAt: doc.detectedAt,
        readAt: doc.readAt || null,
        archivedAt: doc.archivedAt || null,
        evidence: doc.evidence,
        createdAt: doc.createdAt,
    };
}

async function createTrack(actor, body = {}) {
    const ownerUserId = actorIdOf(actor);
    if (!ownerUserId) throw httpError(401, "Thiếu actor");
    const setupId = String(body.source?.setupId || body.setupId || "").trim();
    const symbol = String(body.source?.symbol || body.symbol || "").trim().toUpperCase();
    if (!setupId || !symbol) throw httpError(400, "Thiếu setupId/symbol");

    const existing = await ResearchTrack.findOne({
        ownerUserId,
        "source.setupId": setupId,
        status: { $in: ["watching", "paused"] },
    }).lean();
    if (existing) throw httpError(409, "Đã theo dõi setup này", { code: "duplicate" });

    const ttlDays = Math.min(30, Math.max(1, Number(body.ttlDays) || 7));
    const doc = await ResearchTrack.create({
        ownerUserId,
        title: String(body.title || `${symbol} setup`).slice(0, 120),
        note: String(body.note || "").slice(0, 2000),
        status: "watching",
        source: {
            exchange: body.source?.exchange || "binance",
            marketType: body.source?.marketType || "usdt_perp_linear",
            symbol,
            timeframe: body.source?.timeframe || body.timeframe || "15m",
            setupId,
            setupVersion: body.source?.setupVersion || body.setupVersion || null,
        },
        baseline: body.baseline || body.sourceSnapshot || { capturedAt: nowMs() },
        dataQuality: "fresh",
        expiresAt: new Date(Date.now() + ttlDays * 86400000),
    });
    return publicTrack(doc);
}

async function listTracks(actor, query = {}) {
    const ownerUserId = actorIdOf(actor);
    const filter = { ownerUserId };
    if (query.status) filter.status = String(query.status);
    const rows = await ResearchTrack.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    return { tracks: rows.map(publicTrack) };
}

async function patchTrack(actor, id, body = {}) {
    const ownerUserId = actorIdOf(actor);
    const doc = await ResearchTrack.findById(String(id || ""));
    if (!doc || doc.ownerUserId !== ownerUserId) throw httpError(404, "Không tìm thấy track");
    if (body.expectedRevision != null && Number(body.expectedRevision) !== doc.revision) {
        throw httpError(409, "Track revision đã đổi", { code: "source_changed" });
    }
    if (body.title != null) doc.title = String(body.title).slice(0, 120);
    if (body.note != null) doc.note = String(body.note).slice(0, 2000);
    if (body.status) {
        if (!["watching", "paused", "archived"].includes(body.status)) {
            throw httpError(400, "status không hợp lệ");
        }
        if (doc.status === "terminal" && body.status !== "archived") {
            throw httpError(409, "Track terminal không resume");
        }
        doc.status = body.status;
    }
    doc.revision += 1;
    await doc.save();
    return publicTrack(doc);
}

/**
 * Materialize tối đa 1 Inbox item / (source, sourceEventId). Worker restart an toàn.
 * Không đổi nghĩa entry_touched → fill.
 */
async function upsertInboxEvent(input = {}) {
    const ownerUserId = String(input.ownerUserId || "");
    const source = String(input.source || "research");
    const sourceEventId = String(input.sourceEventId || crypto.randomUUID());
    if (!ownerUserId) throw httpError(400, "Thiếu ownerUserId");

    try {
        const doc = await InboxItem.create({
            ownerUserId,
            source,
            sourceEventId,
            kind: String(input.kind || "info"),
            title: String(input.title || "Sự kiện").slice(0, 200),
            body: String(input.body || "").slice(0, 2000),
            resourceType: input.resourceType || "research_track",
            resourceId: input.resourceId,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
            detectedAt: input.detectedAt ? new Date(input.detectedAt) : new Date(),
            evidence: input.evidence || null,
        });
        return { created: true, item: publicInbox(doc) };
    } catch (error) {
        if (error?.code === 11000) {
            const existing = await InboxItem.findOne({ ownerUserId, source, sourceEventId }).lean();
            return { created: false, duplicate: true, item: publicInbox(existing) };
        }
        throw error;
    }
}

async function listInbox(actor, query = {}) {
    const ownerUserId = actorIdOf(actor);
    const filter = { ownerUserId };
    if (query.unread === "1") filter.readAt = null;
    if (query.archived === "1") filter.archivedAt = { $ne: null };
    else filter.archivedAt = null;
    const rows = await InboxItem.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const unread = await InboxItem.countDocuments({ ownerUserId, readAt: null, archivedAt: null });
    return { items: rows.map(publicInbox), unread };
}

async function markInboxRead(actor, id) {
    const ownerUserId = actorIdOf(actor);
    const doc = await InboxItem.findOneAndUpdate(
        { _id: String(id), ownerUserId },
        { $set: { readAt: new Date() } },
        { new: true }
    ).lean();
    if (!doc) throw httpError(404, "Không tìm thấy inbox item");
    return publicInbox(doc);
}

/**
 * Đánh giá tối giản: chỉ emit entry_touched khi baseline chưa có firstTouchedAt
 * và observation có entryTouched=true từ closed candle — không suy fill.
 */
async function evaluateTrackObservation(trackId, observation = {}) {
    const doc = await ResearchTrack.findById(String(trackId || ""));
    if (!doc) throw httpError(404, "Không tìm thấy track");
    if (doc.status !== "watching") {
        return { skipped: true, reason: "not_watching" };
    }
    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
        doc.status = "terminal";
        doc.terminalReason = "tracking_expired";
        await doc.save();
        const inbox = await upsertInboxEvent({
            ownerUserId: doc.ownerUserId,
            source: "research",
            sourceEventId: `${doc._id}:tracking_expired`,
            kind: "tracking_expired",
            title: `${doc.source.symbol}: hết hạn theo dõi`,
            resourceId: String(doc._id),
            evidence: { terminalReason: "tracking_expired" },
        });
        return { terminal: true, inbox };
    }

    doc.lastObservation = observation;
    doc.lastCheckedAt = new Date();
    doc.dataQuality = observation.quality || doc.dataQuality;

    const events = [];
    if (observation.missing === true) {
        // không tạo tín hiệu ngược
        await doc.save();
        return { skipped: true, reason: "missing_data", events };
    }

    if (observation.entryTouched === true
        && observation.candleClosed === true
        && !doc.baseline?.firstTouchedAt) {
        doc.baseline = { ...(doc.baseline || {}), firstTouchedAt: observation.sourceAt || nowMs() };
        const sourceEventId = `${doc._id}:entry_touched`;
        const inbox = await upsertInboxEvent({
            ownerUserId: doc.ownerUserId,
            source: "research",
            sourceEventId,
            kind: "entry_touched",
            title: `${doc.source.symbol}: chạm vùng entry (không phải fill)`,
            resourceId: String(doc._id),
            occurredAt: observation.sourceAt,
            detectedAt: nowMs(),
            evidence: { candleClosed: true, note: "not_a_fill" },
        });
        events.push(inbox);
    }

    if (observation.setupStatus === "invalidated" || observation.setupStatus === "expired") {
        doc.status = "terminal";
        doc.terminalReason = observation.setupStatus === "invalidated" ? "setup_invalidated" : "setup_expired";
        const inbox = await upsertInboxEvent({
            ownerUserId: doc.ownerUserId,
            source: "research",
            sourceEventId: `${doc._id}:${doc.terminalReason}`,
            kind: doc.terminalReason,
            title: `${doc.source.symbol}: ${doc.terminalReason}`,
            resourceId: String(doc._id),
        });
        events.push(inbox);
    }

    await doc.save();
    return { events, track: publicTrack(doc) };
}

module.exports = {
    createTrack,
    listTracks,
    patchTrack,
    upsertInboxEvent,
    listInbox,
    markInboxRead,
    evaluateTrackObservation,
    publicTrack,
    publicInbox,
};
