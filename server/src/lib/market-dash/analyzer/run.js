/**
 * Analyzer: regime/pulse + setups khi nến đóng; ghi signals Mongo.
 */
const MarketDashSignal = require("../../../models/market-dash-signal");
const { config, SCAN_TFS } = require("../config");
const { loadClosedCandles } = require("../../market/candles");
const { classifyFromCandles } = require("./regime");
const { buildPulse } = require("./pulse");
const { detectSetups, setupStillValid } = require("./setups");
const { computeSignalScore } = require("./score");
const { computeDashIndicators } = require("./indicators");
const {
    getDerivatives,
    getMacro,
    getTickers,
    getSymbolSnap,
    savePulse,
    saveHeatmap,
    saveOverview,
} = require("../store");
const { getDashUniverse } = require("../universe");
const { maybeAlertSignal, maybeAlertRegime } = require("../alerts");

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function rs7d(coinChange7d, btcChange7d) {
    if (coinChange7d == null || btcChange7d == null) return null;
    // approximate: (1+c)/(1+b) when changes are percent
    const c = 1 + coinChange7d / 100;
    const b = 1 + btcChange7d / 100;
    if (b === 0) return null;
    return Math.round((c / b) * 1000) / 1000;
}

async function upsertSignal(doc) {
    const filter = {
        symbol: doc.symbol,
        setup: doc.setup,
        timeframe: doc.timeframe,
        active: true,
    };
    const existing = await MarketDashSignal.findOne(filter).lean();
    if (existing) {
        // Dedup: giữ 1 active cho đến reset
        if (existing.candleCloseTime === doc.candleCloseTime) return { action: "same", row: existing };
        return { action: "exists", row: existing };
    }
    const created = await MarketDashSignal.create(doc);
    return { action: "created", row: created.toObject() };
}

async function resetStaleSignals(symbol, timeframe, closedCandles) {
    const active = await MarketDashSignal.find({ symbol, timeframe, active: true }).lean();
    for (const row of active) {
        const still = setupStillValid(closedCandles, row.setup);
        if (!still) {
            await MarketDashSignal.updateOne(
                { _id: row._id },
                { $set: { active: false, resetAt: new Date() } }
            );
        }
    }
}

async function analyzeBtcRegimes() {
    const out = { "4h": null, "1d": null, "1h": null };
    for (const tf of ["4h", "1d", "1h"]) {
        try {
            const { closed } = await loadClosedCandles("BTCUSDT", tf, {
                force: true,
                limit: config.candleLimit,
            });
            if (closed.length >= 50) {
                out[tf] = classifyFromCandles(closed);
            }
        } catch (error) {
            console.warn(`[MARKET_DASH] regime BTC ${tf}`, error.message || error);
        }
    }
    return out;
}

async function buildHeatmapPayload() {
    const uni = getDashUniverse();
    const tickers = await getTickers();
    const cells = [];
    for (const row of uni.rows || []) {
        const t = tickers.get(row.symbol);
        const snap = await getSymbolSnap(row.symbol);
        cells.push({
            symbol: row.symbol,
            quoteVolume: t?.quoteVolume ?? row.quoteVolume,
            lastPrice: t?.lastPrice ?? snap?.lastPrice ?? row.lastPrice,
            change1h: null,
            change4h: null,
            change24h: t?.priceChangePercent ?? row.priceChangePercent,
            change7d: null,
            funding: snap?.funding ?? null,
            fundingPercentile: snap?.fundingPercentile ?? null,
            oiDelta24h: snap?.oiDelta24h ?? null,
            score: null,
        });
    }
    const heatmap = {
        updatedAt: new Date().toISOString(),
        cells,
        colorModes: ["change24h", "fundingPercentile", "oiDelta24h"],
        sizeMode: "quoteVolume",
    };
    await saveHeatmap(heatmap);
    return heatmap;
}

async function scanUniverse(regimes) {
    const uni = getDashUniverse();
    const tickers = await getTickers();
    const btcTicker = tickers.get("BTCUSDT");
    const regime1d = regimes["1d"]?.regime || null;
    let created = 0;
    let scanned = 0;

    // Limit scan concurrency for rate limits — sequential with small sleep
    const symbols = uni.symbols.slice(0, config.topN);
    for (const symbol of symbols) {
        for (const tf of SCAN_TFS) {
            try {
                const { closed } = await loadClosedCandles(symbol, tf, {
                    force: scanned % 15 === 0,
                    limit: config.candleLimit,
                });
                if (closed.length < 60) continue;
                await resetStaleSignals(symbol, tf, closed);
                const setups = detectSetups(closed);
                scanned += 1;
                if (!setups.length) continue;

                const ind = computeDashIndicators(closed);
                let higherTfInd = null;
                if (tf === "1h") {
                    try {
                        const h = await loadClosedCandles(symbol, "4h", { limit: 120 });
                        higherTfInd = computeDashIndicators(h.closed);
                    } catch {
                        /* ignore */
                    }
                } else if (tf === "4h") {
                    try {
                        const h = await loadClosedCandles(symbol, "1d", { limit: 120 });
                        higherTfInd = computeDashIndicators(h.closed);
                    } catch {
                        /* ignore */
                    }
                }

                const snap = await getSymbolSnap(symbol);
                const ticker = tickers.get(symbol);
                const coinRs = rs7d(ticker?.priceChangePercent, btcTicker?.priceChangePercent);

                for (const s of setups) {
                    const scored = computeSignalScore({
                        setup: s.setup,
                        direction: s.direction,
                        ind,
                        higherTfInd,
                        rs7d: coinRs,
                        fundingPercentile: snap?.fundingPercentile,
                        oiDelta24h: snap?.oiDelta24h,
                        rr: s.rr,
                        regimeBtc1d: regime1d,
                    });
                    const doc = {
                        symbol,
                        setup: s.setup,
                        timeframe: tf,
                        direction: s.direction,
                        scoreRaw: scored.scoreRaw,
                        score: scored.score,
                        scoreBreakdown: scored.breakdown,
                        entry: s.entry,
                        stopLoss: s.stopLoss,
                        takeProfit: s.takeProfit,
                        rr: s.rr,
                        entryZone: s.entryZone,
                        checklist: s.checklist,
                        funding: snap?.funding ?? null,
                        oiDelta24h: snap?.oiDelta24h ?? null,
                        rs7d: coinRs,
                        volSpike: ind?.relativeVolume ?? null,
                        price: s.price,
                        change24h: ticker?.priceChangePercent ?? null,
                        signalTime: new Date(),
                        candleCloseTime: s.candleCloseTime,
                        active: true,
                        regimeBtc1d: regime1d,
                    };
                    const result = await upsertSignal(doc);
                    if (result.action === "created") {
                        created += 1;
                        await maybeAlertSignal(result.row);
                    }
                }
            } catch (error) {
                if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") {
                    console.warn("[MARKET_DASH] scan rate limit, pause");
                    await sleep(5_000);
                    break;
                }
                console.warn(`[MARKET_DASH] scan ${symbol} ${tf}`, error.message || error);
            }
        }
        await sleep(40);
    }
    return { scanned, created };
}

async function runAnalyzer(opts = {}) {
    const regimes = await analyzeBtcRegimes();
    const prevPulse = await require("../store").getPulse();
    const prevRegime = prevPulse?.regime?.["1d"]?.regime;

    const derivatives = await getDerivatives();
    const macro = await getMacro();
    const tickers = await getTickers();
    const btc = tickers.get("BTCUSDT");
    const eth = tickers.get("ETHUSDT");

    const pulse = buildPulse({
        regime4h: regimes["4h"],
        regime1d: regimes["1d"],
        ind1d: regimes["1d"]?.indicators,
        derivatives,
        macro,
        breadth: null,
        btcLevels: regimes["1d"]?.indicators
            ? {
                  support: regimes["1d"].indicators.donchian?.lower,
                  resistance: regimes["1d"].indicators.donchian?.upper,
              }
            : null,
    });
    await savePulse(pulse);

    if (prevRegime && regimes["1d"]?.regime && prevRegime !== regimes["1d"].regime) {
        await maybeAlertRegime(prevRegime, regimes["1d"].regime, pulse);
    }

    const heatmap = await buildHeatmapPayload();

    let scan = { scanned: 0, created: 0 };
    if (opts.scan !== false) {
        scan = await scanUniverse(regimes);
    }

    const overview = {
        updatedAt: new Date().toISOString(),
        topBar: {
            btc: btc
                ? { price: btc.lastPrice, change24h: btc.priceChangePercent }
                : null,
            eth: eth
                ? { price: eth.lastPrice, change24h: eth.priceChangePercent }
                : null,
            btcDominance: macro?.btcDominance ?? null,
            fearGreed: macro?.fearGreed ?? null,
            fearGreedLabel: macro?.fearGreedLabel ?? null,
            totalMarketCap: macro?.totalMarketCap ?? null,
            timezone: "UTC+7",
        },
        universe: getDashUniverse().meta,
        pulseScore: pulse.score,
        regime1d: regimes["1d"]?.regime || null,
        heatmapCells: heatmap.cells?.length || 0,
        scan,
        macroStale: Boolean(macro?.stale),
        macroUpdatedAt: macro?.updatedAt || null,
        derivativesUpdatedAt: derivatives?.updatedAt || null,
    };
    await saveOverview(overview);

    console.log(
        `[MARKET_DASH] analyzer pulse=${pulse.score} regime=${regimes["1d"]?.regime} created=${scan.created}`
    );
    return { pulse, regimes, scan, overview };
}

module.exports = {
    runAnalyzer,
    analyzeBtcRegimes,
    buildHeatmapPayload,
    scanUniverse,
};
