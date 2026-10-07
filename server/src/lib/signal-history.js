const SignalInfo = require("../models/signal-info");
const { openTimeFilter, openTimeRange } = require("./open-time-range");

const SESSIONS = [
    { id: "Á", label: "Phiên Á", from: 7, to: 15, hours: "07:00–15:00" },
    { id: "Âu", label: "Phiên Âu", from: 15, to: 21, hours: "15:00–21:00" },
    { id: "Mỹ", label: "Phiên Mỹ", from: 21, to: 7, hours: "21:00–07:00" },
];

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sessionId(hour) {
    const value = Number(hour);
    if (value >= 7 && value < 15) return "Á";
    if (value >= 15 && value < 21) return "Âu";
    return "Mỹ";
}

function signalChoices(options, bySignalMap) {
    const named = (options || [])
        .map((row) => ({ signal: String(row._id || "").trim(), count: row.count || 0 }))
        .filter((row) => row.signal);
    if (named.length) return named;
    return [...bySignalMap].map(([signal, count]) => ({ signal, count })).sort((a, b) => b.count - a.count);
}

function sessionSummary(rows) {
    const counts = Object.fromEntries(SESSIONS.map((item) => [item.id, 0]));
    for (const row of rows || []) counts[row._id] = row.count || 0;
    const sessions = SESSIONS.map((item) => ({ ...item, count: counts[item.id] || 0 }));
    const topSession = sessions.reduce((best, item) => (item.count > best.count ? item : best), sessions[0]);
    return { sessions, topSession: topSession.count ? topSession : null };
}

function signalMatcher(value) {
    const name = String(value || "").trim();
    if (!name) return null;
    return new RegExp(`^${escapeRegex(name)}$`, "i");
}

function withSignal(stages, matcher) {
    return matcher ? [{ $match: { signal: matcher } }, ...stages] : stages;
}

async function listSignalHistory(_actor, input = {}) {
    const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(input.limit, 10) || 50));
    const range = openTimeRange(input);
    const scope = { openTime: openTimeFilter(range) };
    if (["LONG", "SHORT"].includes(input.side)) scope.side = input.side;
    const query = String(input.q || "").trim();
    if (query) scope.symbol = new RegExp(escapeRegex(query), "i");
    const matcher = signalMatcher(input.signal);
    const filter = matcher ? { ...scope, signal: matcher } : scope;

    const [rows, total, grouped] = await Promise.all([
        SignalInfo.find(filter).select("signal status side symbol type openTime createdAt").sort({ openTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        SignalInfo.countDocuments(filter),
        SignalInfo.aggregate([
            { $match: scope },
            {
                $facet: {
                    bySignalSide: withSignal([{ $group: { _id: { signal: "$signal", side: "$side" }, count: { $sum: 1 } } }], matcher),
                    byType: withSignal([{ $group: { _id: { $ifNull: ["$type", "SCALP"] }, count: { $sum: 1 } } }], matcher),
                    bySymbol: withSignal([{ $group: { _id: "$symbol", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }], matcher),
                    signalOptions: [{ $group: { _id: { $ifNull: ["$signal", ""] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }],
                    bySession: withSignal([
                        { $project: { hour: { $hour: { date: "$openTime", timezone: "Asia/Ho_Chi_Minh" } } } },
                        {
                            $group: {
                                _id: {
                                    $switch: {
                                        branches: [
                                            { case: { $and: [{ $gte: ["$hour", 7] }, { $lt: ["$hour", 15] }] }, then: "Á" },
                                            { case: { $and: [{ $gte: ["$hour", 15] }, { $lt: ["$hour", 21] }] }, then: "Âu" },
                                        ],
                                        default: "Mỹ",
                                    },
                                },
                                count: { $sum: 1 },
                            },
                        },
                    ], matcher),
                },
            },
        ]),
    ]);
    const facet = grouped[0] || {};
    const bySignalMap = new Map();
    let long = 0;
    let short = 0;
    for (const item of facet.bySignalSide || []) {
        const count = item.count || 0;
        const signal = item._id?.signal || "UNKNOWN";
        bySignalMap.set(signal, (bySignalMap.get(signal) || 0) + count);
        if (item._id?.side === "LONG") long += count;
        if (item._id?.side === "SHORT") short += count;
    }
    const { sessions, topSession } = sessionSummary(facet.bySession);
    return {
        rows: rows.map((row) => ({ id: String(row._id), signal: row.signal, status: row.status, side: row.side, symbol: row.symbol, type: row.type, openTime: row.openTime, createdAt: row.createdAt })),
        stats: {
            total,
            long,
            short,
            bySignal: signalChoices(facet.signalOptions, bySignalMap),
            byType: (facet.byType || []).map((row) => ({ type: row._id || "SCALP", count: row.count })).sort((a, b) => b.count - a.count),
            bySymbol: (facet.bySymbol || []).map((row) => ({ symbol: row._id || "—", count: row.count })),
            sessions,
            topSession,
        },
        page,
        limit,
        total,
        from: range.from,
        to: range.to,
    };
}

module.exports = { SESSIONS, sessionId, listSignalHistory };
