const KEY_PREFIX = "wb:pos:";
const CHANNEL_PREFIX = "wb:pos:notify:";
const FRESH_MS = 90 * 1000;

function snapshotKey(account) {
    return `${KEY_PREFIX}${account}`;
}

function notifyChannel(account) {
    return `${CHANNEL_PREFIX}${account}`;
}

function parseNotice(raw) {
    try {
        const message = typeof raw === "string" ? JSON.parse(raw) : raw;
        const version = Number(message?.version);
        const account = String(message?.account || "").trim();
        if (!account || !Number.isFinite(version)) return null;
        return { account, version, at: message.at || null };
    } catch (error) {
        console.error("[positionCache]", error.message);
        return null;
    }
}

function decorateSnapshot(raw, now = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    const at = raw.at || null;
    const age = at ? now - new Date(at).getTime() : null;
    const fresh = age != null && age >= 0 && age <= FRESH_MS;
    return {
        ...raw,
        version: Number(raw.version) || 0,
        status: fresh ? "live" : "stale",
        stale: !fresh,
        positions: Array.isArray(raw.positions) ? raw.positions : [],
        openOrders: Array.isArray(raw.openOrders) ? raw.openOrders : [],
        algoOrders: Array.isArray(raw.algoOrders) ? raw.algoOrders : [],
        monitors: Array.isArray(raw.monitors) ? raw.monitors : [],
    };
}

function decideUpdate(previous, notice, stored) {
    if (!stored) return { action: "keep", stale: true };
    const version = Number(stored.version);
    const notified = notice ? Number(notice.version) : version;
    if (Number.isFinite(notified) && version < notified) return { action: "reread" };
    if (previous && Number(previous.version) === version) return { action: "same", snapshot: stored };
    return { action: "send", snapshot: stored };
}

module.exports = {
    KEY_PREFIX,
    CHANNEL_PREFIX,
    FRESH_MS,
    snapshotKey,
    notifyChannel,
    parseNotice,
    decorateSnapshot,
    decideUpdate,
};
