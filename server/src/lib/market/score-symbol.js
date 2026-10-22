/**
 * Chấm điểm một symbol trên 5 khung + composite + gắn giá ticker.
 */
const { TIMEFRAMES, FORMULA_VERSION, SCHEMA_VERSION, config } = require("./config");
const { loadClosedCandles } = require("./candles");
const { scoreTimeframe } = require("./score-frame");
const { composeAllStyles } = require("./composite");
const { recordEvent } = require("./store");
const { ANALYSIS_TFS, htfOf, buildLocationForTf } = require("./location");

async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let i = 0;
    async function run() {
        while (i < items.length) {
            const idx = i;
            i += 1;
            results[idx] = await worker(items[idx], idx);
        }
    }
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
    await Promise.all(runners);
    return results;
}

function overallQuality(frames) {
    const states = Object.values(frames).map((f) => f?.quality?.overall);
    if (states.every((s) => s === "ready")) return "ready";
    if (states.some((s) => s === "missing")) return "partial";
    if (states.some((s) => s === "warming")) return "warming";
    if (states.some((s) => s === "stale")) return "stale";
    return "partial";
}

async function detectScoreEvents(prev, next) {
    if (!prev || !next) return;
    const style = next.composites?.intraday;
    const prevStyle = prev.composites?.intraday;
    if (style && prevStyle) {
        if (style.status === "lean_long" && prevStyle.status !== "lean_long") {
            await recordEvent({
                symbol: next.symbol,
                type: "lean_long",
                style: "intraday",
                payload: { compositeLong: style.compositeLong, compositeShort: style.compositeShort },
            });
        }
        if (style.status === "lean_short" && prevStyle.status !== "lean_short") {
            await recordEvent({
                symbol: next.symbol,
                type: "lean_short",
                style: "intraday",
                payload: { compositeLong: style.compositeLong, compositeShort: style.compositeShort },
            });
        }
        if (prevStyle.conflict && !style.conflict) {
            await recordEvent({
                symbol: next.symbol,
                type: "conflict_cleared",
                style: "intraday",
                payload: {},
            });
        }
        if (
            style.compositeLong != null &&
            prevStyle.compositeLong != null &&
            Math.abs(style.compositeLong - prevStyle.compositeLong) >= 8
        ) {
            await recordEvent({
                symbol: next.symbol,
                type: "score_delta",
                style: "intraday",
                payload: {
                    from: prevStyle.compositeLong,
                    to: style.compositeLong,
                    side: "long",
                },
            });
        }
    }
    for (const tf of TIMEFRAMES) {
        const a = prev.timeframes?.[tf];
        const b = next.timeframes?.[tf];
        if (a?.regime && b?.regime && a.regime !== b.regime) {
            await recordEvent({
                symbol: next.symbol,
                type: "regime_change",
                timeframe: tf,
                payload: { from: a.regime, to: b.regime },
            });
        }
    }
}

/**
 * @param {string} symbol
 * @param {{ ticker?: object, universeVersion?: number, prev?: object|null, force?: boolean, fetchImpl?: Function, now?: number, timeframes?: string[] }} opts
 */
async function scoreSymbol(symbol, opts = {}) {
    const sym = String(symbol || "").trim().toUpperCase();
    const now = opts.now || Date.now();
    const tfs = opts.timeframes || TIMEFRAMES;
    const frames = {};
    const closedByTf = {};

    await mapPool(tfs, 1, async (tf) => {
        try {
            const pack = await loadClosedCandles(sym, tf, {
                force: opts.force,
                fetchImpl: opts.fetchImpl,
                now,
            });
            closedByTf[tf] = pack.closed || [];
            frames[tf] = scoreTimeframe(pack.closed, { timeframe: tf, now, symbol: sym });
            frames[tf].formingCandle = pack.formingCandle;
        } catch (error) {
            console.warn(`[scoreSymbol] ${sym} ${tf}`, error.message || error);
            closedByTf[tf] = [];
            frames[tf] = scoreTimeframe([], { timeframe: tf, now, symbol: sym });
            frames[tf].error = error.message || String(error);
        }
    });

    const composites = composeAllStyles(frames);
    const qualityOverall = overallQuality(frames);
    const ticker = opts.ticker || {};
    const primary = frames["15m"] || frames["1h"] || Object.values(frames)[0];
    const priceLast = ticker.lastPrice ?? ticker.mark ?? primary?.indicators?.lastClose ?? null;
    const priceAsOf = ticker.time
        ? new Date(ticker.time).toISOString()
        : new Date(now).toISOString();
    const priceSource = ticker.lastPrice != null || ticker.mark != null ? "ticker" : "candle_close";

    // Vùng/setup additive — không đổi frames/composites market-v1.
    const locationByTimeframe = {};
    for (const tf of ANALYSIS_TFS) {
        if (!tfs.includes(tf)) continue;
        const htf = htfOf(tf);
        const htfBias = htf == null ? "n/a" : frames[htf]?.structureBias || "unknown";
        try {
            locationByTimeframe[tf] = buildLocationForTf(closedByTf[tf] || [], {
                symbol: sym,
                timeframe: tf,
                structureBias: frames[tf]?.structureBias || "unknown",
                htfBias,
                prev: opts.prev?.locationByTimeframe?.[tf] || null,
                price: priceLast,
                priceAsOf,
                priceSource,
                now,
            });
        } catch (error) {
            console.warn(`[scoreSymbol] location ${sym} ${tf}`, error.message || error);
            locationByTimeframe[tf] = {
                timeframe: tf,
                quality: "partial",
                error: error.message || String(error),
                zones: opts.prev?.locationByTimeframe?.[tf]?.zones || [],
                setups: opts.prev?.locationByTimeframe?.[tf]?.setups || [],
            };
        }
    }

    const snapshot = {
        symbol: sym,
        schemaVersion: SCHEMA_VERSION,
        formulaVersion: FORMULA_VERSION,
        universeVersion: opts.universeVersion ?? null,
        calculatedAt: new Date(now).toISOString(),
        qualityOverall,
        inTop: opts.inTop !== false,
        volumeRank: opts.volumeRank ?? null,
        price: {
            last: priceLast,
            changePct24h: ticker.priceChangePercent ?? null,
            volume24h: ticker.quoteVolume ?? null,
            asOf: priceAsOf,
            source: priceSource,
        },
        timeframes: frames,
        composites,
        locationByTimeframe,
        links: {
            smartMoney: `/smart-money?symbol=${sym}`,
            terminal: `/terminal?symbol=${sym}`,
        },
    };

    if (opts.prev) {
        try {
            await detectScoreEvents(opts.prev, snapshot);
        } catch (error) {
            console.warn("[scoreSymbol] events", error.message || error);
        }
    }

    return snapshot;
}

module.exports = {
    scoreSymbol,
    overallQuality,
    mapPool,
};
