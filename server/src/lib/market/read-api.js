/**
 * API đọc cache/Mongo — không gọi sàn từ request HTTP.
 */
const { STYLES, TIMEFRAMES, FORMULA_VERSION, config } = require("./config");
const { getMarketUniverse, buildMarketUniverse } = require("./universe");
const {
    getLatestSnapshot,
    listLatestSnapshots,
    listHistory,
    listEvents,
    getCollectorMeta,
} = require("./store");
const { getLatestSnapshot: getSmartMoneySnapshot } = require("../smart-money/store");
const { buildPriceSeed, hasScoredFrames, estimateEtaSeconds } = require("./price-seed");

const SYMBOL_RE = /^[A-Z0-9]{4,25}$/;

function formatEta(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (s <= 0) return "xong";
    if (s < 60) return `~${s}s`;
    const m = Math.ceil(s / 60);
    return m <= 1 ? "~1 phút" : `~${m} phút`;
}

function normalizeSymbol(raw) {
    const sym = String(raw || "").trim().toUpperCase();
    return SYMBOL_RE.test(sym) ? sym : null;
}

function cellSummary(frame) {
    if (!frame) return { bias: "wait", lead: null, longScore: null, shortScore: null, quality: "missing" };
    const bias = frame.bias || "wait";
    let lead = null;
    if (bias === "long" && frame.longScore != null) lead = frame.longScore;
    else if (bias === "short" && frame.shortScore != null) lead = frame.shortScore;
    else if (frame.longScore != null || frame.shortScore != null) {
        lead = Math.max(frame.longScore ?? 0, frame.shortScore ?? 0);
    }
    return {
        bias,
        lead,
        longScore: frame.longScore,
        shortScore: frame.shortScore,
        regime: frame.regime,
        quality: frame.quality?.overall || null,
        candleCloseTime: frame.candleCloseTime,
    };
}

function rowFromSnapshot(snap, styleId) {
    const style = styleId || config.defaultStyle;
    const composite = snap.composites?.[style] || snap.composites?.intraday;
    const cells = {};
    for (const tf of TIMEFRAMES) cells[tf] = cellSummary(snap.timeframes?.[tf]);
    const pending = snap.qualityOverall === "pending" || snap.phase === "price" || !hasScoredFrames(snap);
    return {
        symbol: snap.symbol,
        price: snap.price,
        volumeRank: snap.volumeRank,
        inTop: snap.inTop !== false,
        qualityOverall: snap.qualityOverall,
        phase: snap.phase || (pending ? "price" : "scored"),
        pending,
        calculatedAt: snap.calculatedAt,
        formulaVersion: snap.formulaVersion,
        cells,
        composite: composite
            ? {
                  style: composite.style,
                  long: composite.compositeLong,
                  short: composite.compositeShort,
                  status: composite.status,
                  conflict: composite.conflict,
                  eligible: composite.eligible,
                  lean: composite.lean,
              }
            : null,
        delta: snap.delta || null,
    };
}

async function getStatusPayload() {
    const universe = getMarketUniverse().symbols.length
        ? getMarketUniverse()
        : await buildMarketUniverse();
    const meta = await getCollectorMeta();
    const snaps = await listLatestSnapshots(universe.symbols || []);
    const total = universe.symbols.length || config.topN;
    const ready = snaps.filter((s) => s.qualityOverall === "ready").length;
    const warming = snaps.filter((s) => s.qualityOverall === "warming").length;
    const pending = snaps.filter((s) => s.qualityOverall === "pending" || s.phase === "price").length;
    const scored = snaps.filter((s) => hasScoredFrames(s)).length;
    const priced = snaps.filter((s) => s.price?.last != null).length;
    const remaining = Math.max(0, total - scored);
    const etaSeconds =
        meta?.etaSeconds != null
            ? meta.etaSeconds
            : estimateEtaSeconds({ remainingSymbols: remaining, bootstrap: remaining > 0 });
    const style = config.defaultStyle;
    let leanLong = 0;
    let leanShort = 0;
    let conflict = 0;
    let eligible = 0;
    let trending = 0;
    let ranging = 0;
    let transitional = 0;
    for (const s of snaps) {
        if (!hasScoredFrames(s)) continue;
        const c = s.composites?.[style];
        if (c?.lean === "lean_long") leanLong += 1;
        if (c?.lean === "lean_short") leanShort += 1;
        if (c?.conflict) conflict += 1;
        if (c?.eligible) eligible += 1;
        const mid = s.timeframes?.["1h"]?.regime;
        if (mid === "trending") trending += 1;
        else if (mid === "ranging") ranging += 1;
        else if (mid === "transitional") transitional += 1;
    }
    return {
        formulaVersion: FORMULA_VERSION,
        defaultStyle: style,
        styles: Object.values(STYLES).map((s) => ({ id: s.id, label: s.label, frames: s.frames })),
        timeframes: TIMEFRAMES,
        universe: {
            version: universe.version,
            topN: universe.meta?.topN || config.topN,
            count: universe.symbols.length,
            refreshedAt: universe.meta?.refreshedAt || null,
        },
        coverage: {
            ready,
            warming,
            pending,
            priced,
            scored,
            total,
            label: `${scored}/${total} đã chấm · ${priced}/${total} có giá`,
        },
        progress: {
            priced,
            scored,
            ready,
            pending,
            total,
            remaining,
            etaSeconds,
            etaLabel: formatEta(etaSeconds),
            complete: remaining === 0 && total > 0,
            bootstrapHint:
                "Giá/%/volume hiện ngay từ ticker. Điểm từng khung bổ sung dần (~3–6 phút lần đầu, 50×5 klines).",
        },
        breadth: { leanLong, leanShort, conflict, eligible, trending, ranging, transitional },
        collector: meta,
        note: "Điểm kỹ thuật market-v1 — không phải xác suất thắng. Chỉ nến đóng.",
    };
}

async function listSymbolsQuery(query = {}) {
    const style = STYLES[query.style] ? query.style : config.defaultStyle;
    const universe = getMarketUniverse().symbols.length
        ? getMarketUniverse()
        : await buildMarketUniverse();
    const snapList = await listLatestSnapshots(universe.symbols || []);
    const snapMap = new Map(snapList.map((s) => [s.symbol, s]));

    // Ghép universe + snapshot: thiếu score vẫn hiện giá từ ticker/seed.
    let snaps = (universe.meta?.rows || universe.symbols.map((symbol) => ({ symbol }))).map((meta) => {
        const existing = snapMap.get(meta.symbol);
        if (existing) return existing;
        return buildPriceSeed({
            symbol: meta.symbol,
            ticker: {
                lastPrice: meta.lastPrice,
                priceChangePercent: meta.priceChangePercent,
                quoteVolume: meta.quoteVolume,
            },
            meta,
            universeVersion: universe.version,
        });
    });

    const scoredCount = snaps.filter((s) => hasScoredFrames(s)).length;
    const mostlyPending = scoredCount < Math.max(5, snaps.length * 0.3);

    const q = String(query.q || "").trim().toUpperCase();
    if (q) snaps = snaps.filter((s) => s.symbol.includes(q));

    const side = String(query.side || "").toLowerCase();
    if (side === "long" || side === "lean_long") {
        snaps = snaps.filter((s) => s.composites?.[style]?.lean === "lean_long");
    } else if (side === "short" || side === "lean_short") {
        snaps = snaps.filter((s) => s.composites?.[style]?.lean === "lean_short");
    } else if (side === "wait") {
        snaps = snaps.filter((s) => hasScoredFrames(s) && (s.composites?.[style]?.lean || "wait") === "wait");
    }

    const regime = String(query.regime || "").toLowerCase();
    if (regime) {
        snaps = snaps.filter((s) => s.timeframes?.["1h"]?.regime === regime);
    }

    const minScore = Number(query.minScore);
    if (Number.isFinite(minScore)) {
        snaps = snaps.filter((s) => {
            const c = s.composites?.[style];
            const lead = Math.max(c?.compositeLong ?? 0, c?.compositeShort ?? 0);
            return lead >= minScore;
        });
    }

    if (query.consensus === "1" || query.consensus === "true") {
        snaps = snaps.filter((s) => s.composites?.[style]?.eligible);
    }
    if (query.conflict === "1" || query.conflict === "true") {
        snaps = snaps.filter((s) => s.composites?.[style]?.conflict);
    }
    if (query.fresh === "1" || query.fresh === "true") {
        snaps = snaps.filter((s) => s.qualityOverall === "ready");
    }
    if (query.topOnly === "1" || query.topOnly === "true") {
        snaps = snaps.filter((s) => s.inTop !== false);
    }

    // Khi chưa chấm nhiều: mặc định xếp theo volume để bảng có ý nghĩa ngay.
    const sortRaw = String(query.sort || "");
    const allowedSort = new Set([
        "symbol",
        "price",
        "change",
        "volume",
        "composite",
        "status",
        ...TIMEFRAMES,
    ]);
    const sort = allowedSort.has(sortRaw) ? sortRaw : mostlyPending ? "volume" : "composite";
    const dirKey = String(query.dir || "desc") === "asc" ? "asc" : "desc";
    const dir = dirKey === "asc" ? 1 : -1;
    const statusRank = (s) => {
        const st = s.composites?.[style]?.status;
        if (st === "lean_long") return 3;
        if (st === "lean_short") return 2;
        if (st === "conflict") return 1;
        if (st === "incomplete" || s.qualityOverall === "pending") return -1;
        return 0;
    };
    snaps.sort((a, b) => {
        const ca = a.composites?.[style];
        const cb = b.composites?.[style];
        let cmp = 0;
        if (sort === "symbol") {
            cmp = String(a.symbol).localeCompare(String(b.symbol));
        } else if (sort === "price") {
            cmp = (a.price?.last ?? -1) - (b.price?.last ?? -1);
        } else if (sort === "change") {
            cmp = (a.price?.changePct24h ?? -999) - (b.price?.changePct24h ?? -999);
        } else if (sort === "volume") {
            cmp = (a.price?.volume24h ?? 0) - (b.price?.volume24h ?? 0);
        } else if (sort === "status") {
            cmp = statusRank(a) - statusRank(b);
        } else if (TIMEFRAMES.includes(sort)) {
            const cellA = cellSummary(a.timeframes?.[sort]);
            const cellB = cellSummary(b.timeframes?.[sort]);
            cmp = (cellA.lead ?? -1) - (cellB.lead ?? -1);
        } else {
            cmp =
                Math.max(ca?.compositeLong ?? -1, ca?.compositeShort ?? -1) -
                Math.max(cb?.compositeLong ?? -1, cb?.compositeShort ?? -1);
        }
        if (cmp === 0) return (a.volumeRank ?? 999) - (b.volumeRank ?? 999);
        return cmp * dir;
    });

    const limit = Math.min(config.listLimitMax, Math.max(1, Number(query.limit) || config.topN));
    const rows = snaps.slice(0, limit).map((s) => rowFromSnapshot(s, style));
    return {
        style,
        sort,
        dir: dirKey,
        count: rows.length,
        totalScored: scoredCount,
        totalRows: snaps.length,
        universeVersion: universe.version,
        formulaVersion: FORMULA_VERSION,
        progressive: mostlyPending,
        rows,
    };
}

async function getSymbolDetail(symbolRaw, query = {}) {
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol) return { error: "symbol_invalid", status: 400 };
    const style = STYLES[query.style] ? query.style : config.defaultStyle;
    const timeframe = TIMEFRAMES.includes(query.timeframe) ? query.timeframe : null;
    const snap = await getLatestSnapshot(symbol);
    if (!snap) return { error: "not_found", status: 404 };

    let flow = null;
    try {
        const sm = await getSmartMoneySnapshot(symbol);
        if (sm) {
            flow = {
                collectedAt: sm.collectedAt,
                bias: sm.moneyFlow?.bias || sm.bias || null,
                quality: sm.quality?.overall || null,
                openInterest: sm.openInterest
                    ? { status: sm.openInterest.status, value: sm.openInterest.openInterest }
                    : null,
                funding: sm.funding ? { status: sm.funding.status, rate: sm.funding.fundingRate } : null,
                note: "Flow từ snapshot Smart Money dùng chung — không cộng vào technical score.",
            };
        }
    } catch (error) {
        console.warn("[marketRead] smart money", error.message || error);
    }

    const frame = timeframe ? snap.timeframes?.[timeframe] : null;
    const composite = snap.composites?.[style];
    const strongest =
        frame?.breakdown
            ?.filter((r) => r.points > 0)
            .sort((a, b) => b.points - a.points)[0] || null;
    const weakest =
        frame?.breakdown
            ?.filter((r) => r.points < 0)
            .sort((a, b) => a.points - b.points)[0] || null;

    return {
        symbol,
        style,
        timeframe,
        snapshot: snap,
        composite,
        frame,
        strongest,
        weakest,
        flow,
        links: snap.links,
    };
}

async function getSymbolScores(symbolRaw, query = {}) {
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol) return { error: "symbol_invalid", status: 400 };
    const history = await listHistory(symbol, { limit: query.limit });
    return { symbol, formulaVersion: FORMULA_VERSION, count: history.length, rows: history };
}

module.exports = {
    normalizeSymbol,
    getStatusPayload,
    listSymbolsQuery,
    getSymbolDetail,
    getSymbolScores,
    listEvents,
    cellSummary,
    rowFromSnapshot,
};
