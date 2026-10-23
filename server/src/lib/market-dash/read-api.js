/**
 * Read API snapshot cho Market Dashboard UI.
 */
const MarketDashSignal = require("../../models/market-dash-signal");
const MarketDashCollectorState = require("../../models/market-dash-collector-state");
const { loadClosedCandles } = require("../market/candles");
const { computeDashIndicators } = require("./analyzer/indicators");
const { detectSetups } = require("./analyzer/setups");
const { config, SCAN_TFS } = require("./config");
const {
    getOverview,
    getPulse,
    getDerivatives,
    getHeatmap,
    getMacro,
    getTickers,
    getSymbolSnap,
} = require("./store");
const { getDashUniverse } = require("./universe");

function ageMs(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return Date.now() - t;
}

function staleFlag(iso, maxMs) {
    const age = ageMs(iso);
    if (age == null) return { stale: true, ageMs: null, reason: "missing" };
    return { stale: age > maxMs, ageMs: age, reason: age > maxMs ? "old" : null };
}

function utc7Now() {
    const fmt = new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    return fmt.format(new Date());
}

async function getDashOverview() {
    const [overview, pulse, macro, state] = await Promise.all([
        getOverview(),
        getPulse(),
        getMacro(),
        MarketDashCollectorState.findById("mdash-main").lean(),
    ]);
    const tickers = await getTickers();
    const btc = tickers.get("BTCUSDT");
    const eth = tickers.get("ETHUSDT");

    return {
        updatedAt: overview?.updatedAt || new Date().toISOString(),
        clockUtc7: utc7Now(),
        topBar: {
            btc: btc
                ? { price: btc.lastPrice, change24h: btc.priceChangePercent }
                : overview?.topBar?.btc || null,
            eth: eth
                ? { price: eth.lastPrice, change24h: eth.priceChangePercent }
                : overview?.topBar?.eth || null,
            btcDominance: macro?.btcDominance ?? overview?.topBar?.btcDominance ?? null,
            ethDominance: macro?.ethDominance ?? null,
            fearGreed: macro?.fearGreed ?? overview?.topBar?.fearGreed ?? null,
            fearGreedLabel: macro?.fearGreedLabel ?? overview?.topBar?.fearGreedLabel ?? null,
            totalMarketCap: macro?.totalMarketCap ?? overview?.topBar?.totalMarketCap ?? null,
        },
        freshness: {
            macro: staleFlag(macro?.updatedAt, 15 * 60_000),
            overview: staleFlag(overview?.updatedAt, 5 * 60_000),
            pulse: staleFlag(pulse?.updatedAt, 5 * 60_000),
        },
        universe: getDashUniverse().meta,
        collector: {
            status: state?.status || "unknown",
            lastSuccessAt: state?.lastSuccessAt || null,
            lastError: state?.lastError || null,
            metrics: state?.metrics || null,
        },
        disclaimer: "Gợi ý tham khảo, không phải khuyến nghị đầu tư",
    };
}

async function getDashPulse() {
    const pulse = await getPulse();
    if (!pulse) {
        return {
            score: null,
            label: "Đang thu thập",
            brief: ["Chưa có Market Pulse — collector đang chạy"],
            freshness: staleFlag(null, 0),
        };
    }
    return {
        ...pulse,
        freshness: staleFlag(pulse.updatedAt, 5 * 60_000),
        clockUtc7: utc7Now(),
    };
}

async function getDashHeatmap(query = {}) {
    let heatmap = await getHeatmap();
    if (!heatmap) {
        const { buildHeatmapPayload } = require("./analyzer/run");
        heatmap = await buildHeatmapPayload();
    }
    const colorMode = ["change24h", "change1h", "change4h", "change7d", "fundingPercentile", "oiDelta24h"].includes(
        query.color
    )
        ? query.color
        : "change24h";
    return {
        ...heatmap,
        colorMode,
        freshness: staleFlag(heatmap.updatedAt, 60_000),
        clockUtc7: utc7Now(),
    };
}

async function getDashDerivatives() {
    const deriv = await getDerivatives();
    if (!deriv) {
        return {
            fundingOiWeightedTop20: null,
            coins: [],
            freshness: staleFlag(null, 0),
            message: "Chưa có dữ liệu derivatives",
        };
    }
    return {
        ...deriv,
        freshness: staleFlag(deriv.updatedAt, 2 * 60_000),
        clockUtc7: utc7Now(),
    };
}

async function listDashSignals(query = {}) {
    const filter = { active: true };
    if (query.setup) filter.setup = String(query.setup);
    if (query.timeframe && SCAN_TFS.includes(query.timeframe)) filter.timeframe = query.timeframe;
    if (query.direction === "long" || query.direction === "short") filter.direction = query.direction;
    if (query.symbol) filter.symbol = String(query.symbol).toUpperCase();
    const minScore = Number(query.minScore);
    if (Number.isFinite(minScore)) filter.score = { $gte: minScore };

    const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit, 10) || 50));
    const rows = await MarketDashSignal.find(filter)
        .sort({ score: -1, signalTime: -1 })
        .limit(limit)
        .lean();

    const now = Date.now();
    return {
        updatedAt: new Date().toISOString(),
        clockUtc7: utc7Now(),
        count: rows.length,
        signals: rows.map((r) => ({
            id: String(r._id),
            symbol: r.symbol,
            setup: r.setup,
            timeframe: r.timeframe,
            direction: r.direction,
            score: r.score,
            scoreRaw: r.scoreRaw,
            price: r.price,
            change24h: r.change24h,
            funding: r.funding,
            oiDelta24h: r.oiDelta24h,
            rs7d: r.rs7d,
            volSpike: r.volSpike,
            entry: r.entry,
            stopLoss: r.stopLoss,
            takeProfit: r.takeProfit,
            entryZone: r.entryZone,
            rr: r.rr,
            signalTime: r.signalTime,
            candleCloseTime: r.candleCloseTime,
            ageMs: r.signalTime ? now - new Date(r.signalTime).getTime() : null,
            regimeBtc1d: r.regimeBtc1d,
            checklist: r.checklist,
        })),
    };
}

async function getDashSymbolDetail(symbol, query = {}) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return { error: "Thiếu symbol", status: 400 };
    const tf = SCAN_TFS.includes(query.tf) ? query.tf : "1h";

    const [snap, tickers, signals] = await Promise.all([
        getSymbolSnap(sym),
        getTickers(),
        MarketDashSignal.find({ symbol: sym, active: true }).sort({ score: -1 }).limit(10).lean(),
    ]);

    const ticker = tickers.get(sym);
    const mtf = {};
    for (const frame of ["15m", "1h", "4h", "1d"]) {
        try {
            const { closed } = await loadClosedCandles(sym, frame, { limit: 120 });
            const ind = computeDashIndicators(closed);
            if (!ind) {
                mtf[frame] = null;
                continue;
            }
            let trend = "range";
            if (ind.ema20 != null && ind.ema50 != null) {
                if (ind.ema20 > ind.ema50 && ind.lastClose > ind.ema50) trend = "up";
                else if (ind.ema20 < ind.ema50 && ind.lastClose < ind.ema50) trend = "down";
            }
            mtf[frame] = {
                trend,
                rsi14: ind.rsi14,
                ema20: ind.ema20,
                ema50: ind.ema50,
                ema200: ind.ema200,
                price: ind.lastClose,
            };
        } catch (error) {
            mtf[frame] = { error: String(error.message || error) };
        }
    }

    let candles = [];
    let indicators = null;
    let liveSetups = [];
    try {
        const loaded = await loadClosedCandles(sym, tf, { force: true, limit: config.candleLimit });
        candles = loaded.closed.slice(-120).map((c) => ({
            time: Math.floor(c.openTime / 1000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
        }));
        indicators = computeDashIndicators(loaded.closed);
        liveSetups = detectSetups(loaded.closed);
    } catch (error) {
        console.warn(`[MARKET_DASH] detail candles ${sym}`, error.message || error);
    }

    const emaOverlay =
        indicators && candles.length
            ? {
                  ema20: indicators.ema20,
                  ema50: indicators.ema50,
                  ema200: indicators.ema200,
              }
            : null;

    return {
        symbol: sym,
        timeframe: tf,
        ticker: ticker || null,
        snap: snap || null,
        mtf,
        candles,
        emaOverlay,
        indicators: indicators
            ? {
                  ema20: indicators.ema20,
                  ema50: indicators.ema50,
                  ema200: indicators.ema200,
                  rsi14: indicators.rsi14,
                  atr14: indicators.atr14,
                  adx: indicators.adx,
                  relativeVolume: indicators.relativeVolume,
              }
            : null,
        liveSetups: liveSetups.map((s) => ({
            setup: s.setup,
            setupLabel: s.setupLabel,
            direction: s.direction,
            checklist: s.checklist,
            entry: s.entry,
            stopLoss: s.stopLoss,
            takeProfit: s.takeProfit,
            rr: s.rr,
        })),
        signals: signals.map((r) => ({
            id: String(r._id),
            setup: r.setup,
            timeframe: r.timeframe,
            direction: r.direction,
            score: r.score,
            scoreRaw: r.scoreRaw,
            checklist: r.checklist,
            entry: r.entry,
            stopLoss: r.stopLoss,
            takeProfit: r.takeProfit,
            rr: r.rr,
            signalTime: r.signalTime,
        })),
        clockUtc7: utc7Now(),
        updatedAt: new Date().toISOString(),
        disclaimer: "Gợi ý tham khảo, không phải khuyến nghị đầu tư",
    };
}

module.exports = {
    getDashOverview,
    getDashPulse,
    getDashHeatmap,
    getDashDerivatives,
    listDashSignals,
    getDashSymbolDetail,
    utc7Now,
};
