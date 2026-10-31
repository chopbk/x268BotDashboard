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
const { listRecentSignalsBySymbols } = require("../signal-history");
const {
    normalizeTop,
    normalizeAnalysisTf,
    normalizeScreen,
    normalizeEntrySource,
    reenrichLocation,
    matchScreen,
    sortLocationRows,
    buildSignalEntries,
    locationSummary,
} = require("./location-read");
const { ANALYSIS_TFS } = require("./location");
const {
    buildOverviewContext,
    buildRowContext,
    buildDecisionContext,
    enrichPrimarySetupFields,
} = require("./market-context");
const { findSymbolInfo, findSymbolInfoMap } = require("../symbol-info");

const SYMBOL_RE = /^[A-Z0-9]{4,25}$/;

async function attachSymbolInfoToRows(rows) {
    if (!rows?.length) return rows;
    try {
        const map = await findSymbolInfoMap(rows.map((r) => r.symbol));
        for (const row of rows) {
            row.symbolInfo = map.get(row.symbol) || null;
        }
    } catch (error) {
        console.warn("[marketRead] symbolInfo", error.message || error);
        for (const row of rows) row.symbolInfo = null;
    }
    return rows;
}

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

async function getStatusPayload(query = {}) {
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
    const analysisTf = normalizeAnalysisTf(query.analysisTf);
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
    const breadth = { leanLong, leanShort, conflict, eligible, trending, ranging, transitional };
    const coverage = {
        ready,
        warming,
        pending,
        priced,
        scored,
        total,
        label: `${scored}/${total} đã chấm · ${priced}/${total} có giá`,
    };
    const universePayload = {
        version: universe.version,
        topN: universe.meta?.topN || config.topN,
        count: universe.symbols.length,
        refreshedAt: universe.meta?.refreshedAt || null,
    };
    const context = buildOverviewContext({
        snaps,
        universe: universePayload,
        analysisTf,
        breadth,
        coverage,
        collector: meta,
    });
    return {
        formulaVersion: FORMULA_VERSION,
        defaultStyle: style,
        styles: Object.values(STYLES).map((s) => ({ id: s.id, label: s.label, frames: s.frames })),
        timeframes: TIMEFRAMES,
        universe: universePayload,
        coverage,
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
        breadth,
        context,
        collector: meta,
        note: "Điểm kỹ thuật market-v1 — không phải xác suất thắng. Chỉ nến đóng.",
    };
}

function mapFlowSnapshot(sm) {
    if (!sm) return null;
    const bias = sm.derived?.bias || sm.moneyFlow?.bias || null;
    const oiQty = sm.openInterest?.qty ?? sm.openInterest?.openInterest ?? null;
    const oiDeltaPct = sm.openInterest?.deltaPct ?? null;
    const fundingRate = sm.funding?.currentRate ?? sm.funding?.fundingRate ?? null;
    const quality = sm.quality?.overall || null;
    const stale = quality === "stale";
    return {
        collectedAt: sm.collectedAt,
        bias,
        quality,
        stale,
        openInterest: sm.openInterest
            ? {
                  status: sm.openInterest.status,
                  qty: oiQty,
                  value: oiQty,
                  deltaPct: Number.isFinite(Number(oiDeltaPct)) ? Number(oiDeltaPct) : null,
              }
            : null,
        funding: sm.funding
            ? { status: sm.funding.status, currentRate: fundingRate, rate: fundingRate }
            : null,
        note: "Flow từ snapshot Smart Money dùng chung — không cộng vào technical score.",
    };
}

async function listLocationSymbolsQuery(query = {}) {
    const analysisTf = normalizeAnalysisTf(query.analysisTf);
    const screen = normalizeScreen(query.screen);
    const entrySource = normalizeEntrySource(query.entrySource);
    const top = normalizeTop(query.top ?? query.limit, 10);
    const recentHours = [24, 72, 168].includes(Number(query.recentHours))
        ? Number(query.recentHours)
        : 72;
    const sortKey = String(query.sort || "default");
    const dirKey = String(query.dir || "asc") === "desc" ? "desc" : "asc";
    const includeFlow =
        screen === "flow_aligned" ||
        screen === "has_conflict" ||
        query.includeFlow === "1";

    const universe = getMarketUniverse().symbols.length
        ? getMarketUniverse()
        : await buildMarketUniverse();
    const snapList = await listLatestSnapshots(universe.symbols || []);
    const snapMap = new Map(snapList.map((s) => [s.symbol, s]));
    let metas = universe.meta?.rows || universe.symbols.map((symbol) => ({ symbol }));
    const q = String(query.q || "").trim().toUpperCase();
    if (q) metas = metas.filter((m) => String(m.symbol).includes(q));

    const btcMeta = (universe.meta?.rows || []).find((m) => m.symbol === "BTCUSDT");
    const btcSnap = snapMap.get("BTCUSDT");
    const btcChangePct24h =
        btcSnap?.price?.changePct24h ?? btcMeta?.priceChangePercent ?? null;

    const symbols = metas.map((m) => m.symbol);
    let signalPack = { bySymbol: {} };
    try {
        signalPack = await listRecentSignalsBySymbols(null, {
            symbols: symbols.join(","),
            hours: recentHours,
            perSymbol: 8,
            perSide: 4,
        });
    } catch (error) {
        console.warn("[marketRead] recent signals", error.message || error);
    }

    const now = Date.now();
    const rows = [];
    for (const meta of metas) {
        const snap =
            snapMap.get(meta.symbol) ||
            buildPriceSeed({
                symbol: meta.symbol,
                ticker: {
                    lastPrice: meta.lastPrice,
                    priceChangePercent: meta.priceChangePercent,
                    quoteVolume: meta.quoteVolume,
                },
                meta,
                universeVersion: universe.version,
            });
        const price = snap.price?.last ?? meta.lastPrice ?? null;
        const priceAsOf = snap.price?.asOf || snap.calculatedAt || null;
        const rawLoc = snap.locationByTimeframe?.[analysisTf] || null;
        const loc = rawLoc
            ? reenrichLocation(rawLoc, price, priceAsOf, now)
            : {
                  timeframe: analysisTf,
                  quality: "warming",
                  positionTags: ["unknown"],
                  support: null,
                  resistance: null,
                  primarySetup: null,
                  recentEvents: [],
                  setups: [],
                  price,
                  priceAsOf,
                  priceFresh: false,
              };

        let flow = null;
        if (includeFlow) {
            try {
                flow = mapFlowSnapshot(await getSmartMoneySnapshot(meta.symbol));
            } catch {
                flow = null;
            }
        }

        const pack = signalPack.bySymbol?.[meta.symbol];
        const signalEntries = buildSignalEntries(pack, price, loc.atrCurrent).map((e) => ({
            id: e.id,
            source: e.source,
            side: e.side,
            openTime: e.openTime,
            sourceStatus: e.sourceStatus,
            entryReference: e.entryReference,
            priceRelation: e.priceRelation,
            validity: e.validity,
            quality: e.quality,
            missingEntry: e.missingEntry,
        }));

        const composite = snap.composites?.[config.defaultStyle] || snap.composites?.intraday || null;
        const locSummary = locationSummary(loc);
        if (locSummary?.primarySetup) {
            locSummary.primarySetup = enrichPrimarySetupFields(
                locSummary.primarySetup,
                analysisTf,
                loc.candleCloseTime
            );
        }
        const changePct24h = snap.price?.changePct24h ?? meta.priceChangePercent ?? null;
        const rowContext = buildRowContext({
            loc,
            snap,
            flow,
            composite,
            priceChangePct: changePct24h,
            btcChangePct24h,
            canFlowLink: Boolean(includeFlow),
            now,
        });

        rows.push({
            symbol: meta.symbol,
            price: {
                last: price,
                changePct24h: changePct24h,
                volume24h: snap.price?.volume24h ?? meta.quoteVolume ?? null,
                asOf: priceAsOf,
                source: snap.price?.source || "ticker",
            },
            volumeRank: snap.volumeRank ?? meta.volumeRank ?? null,
            location: locSummary,
            context: rowContext,
            setups: (loc.setups || [])
                .filter((s) => s.lifecycle === "active")
                .slice(0, 4)
                .map((s) => ({
                    id: s.id,
                    side: s.side,
                    type: s.type,
                    lifecycle: s.lifecycle,
                    entryState: s.entryState,
                    entryLow: s.entryLow,
                    entryHigh: s.entryHigh,
                    createdAt: s.createdAt,
                    invalidationLevel: s.invalidationLevel ?? null,
                    touchEvidence: s.touchEvidence ?? null,
                    expiresAtIndex: s.expiresAtIndex ?? null,
                })),
            signalEntries,
            signalSummary: pack
                ? { count: pack.count, latest: pack.latest, truncated: pack.truncated }
                : { count: 0, latest: null, truncated: false },
            flow,
            qualityOverall: snap.qualityOverall || loc.quality,
        });
    }

    const matched = rows.filter((r) => matchScreen(r, screen, entrySource));
    sortLocationRows(matched, sortKey, dirKey);
    const totalMatched = matched.length;
    const limited = matched.slice(0, top);
    await attachSymbolInfoToRows(limited);

    return {
        view: "location",
        analysisTf,
        screen,
        entrySource,
        recentHours,
        top,
        sort: sortKey,
        dir: dirKey,
        count: limited.length,
        totalMatched,
        totalRows: rows.length,
        coverage: {
            withLocation: rows.filter((r) => r.location?.quality && r.location.quality !== "warming").length,
            total: rows.length,
            analysisTfs: ANALYSIS_TFS,
        },
        universeVersion: universe.version,
        formulaVersion: FORMULA_VERSION,
        rows: limited,
    };
}

async function listSymbolsQuery(query = {}) {
    if (String(query.view || "") === "location") {
        return listLocationSymbolsQuery(query);
    }

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

    const topRaw = query.top != null ? normalizeTop(query.top, null) : null;
    const limit = Math.min(
        config.listLimitMax,
        Math.max(1, topRaw || Number(query.limit) || config.topN)
    );
    const rows = snaps.slice(0, limit).map((s) => rowFromSnapshot(s, style));
    await attachSymbolInfoToRows(rows);
    return {
        style,
        sort,
        dir: dirKey,
        top: topRaw || limit,
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
        flow = mapFlowSnapshot(await getSmartMoneySnapshot(symbol));
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

    const analysisTf = normalizeAnalysisTf(query.analysisTf || timeframe || "1h");
    const price = snap.price?.last ?? null;
    const priceAsOf = snap.price?.asOf || snap.calculatedAt || null;
    const rawLoc = snap.locationByTimeframe?.[analysisTf] || null;
    const loc = rawLoc ? reenrichLocation(rawLoc, price, priceAsOf) : null;
    const zones = (loc?.zones || []).slice(0, 50);
    const setups = (loc?.setups || []).slice(0, 20);
    const truncated = {
        zones: (loc?.zones || []).length > 50,
        setups: (loc?.setups || []).length > 20,
    };

    let signalEntries = [];
    try {
        const pack = await listRecentSignalsBySymbols(null, {
            symbols: symbol,
            hours: Number(query.recentHours) || 72,
            perSymbol: 10,
            perSide: 5,
        });
        signalEntries = buildSignalEntries(pack.bySymbol?.[symbol], price, loc?.atrCurrent);
    } catch (error) {
        console.warn("[marketRead] symbol signals", error.message || error);
    }

    const locSummary = locationSummary(loc);
    if (locSummary?.primarySetup) {
        locSummary.primarySetup = enrichPrimarySetupFields(
            locSummary.primarySetup,
            analysisTf,
            loc?.candleCloseTime
        );
    }
    const detailFrame = frame || snap.timeframes?.[analysisTf] || null;
    const decisionContext = buildDecisionContext({
        snap,
        loc,
        composite,
        frame: detailFrame,
        flow,
        analysisTf,
        setups,
    });

    let symbolInfo = null;
    try {
        symbolInfo = await findSymbolInfo(symbol);
    } catch (error) {
        console.warn("[marketRead] symbolInfo detail", error.message || error);
    }

    return {
        symbol,
        style,
        timeframe,
        analysisTf,
        view: query.view || null,
        snapshot: snap,
        composite,
        frame,
        strongest,
        weakest,
        flow,
        location: locSummary,
        decisionContext,
        symbolInfo,
        zones,
        setups,
        signalEntries,
        truncated,
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
