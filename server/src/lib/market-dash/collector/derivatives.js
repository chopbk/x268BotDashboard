/**
 * Funding / OI / L/S collector + hist Mongo + snapshot Redis.
 */
const WebSocket = require("ws");
const { config } = require("../config");
const { smartMoneyFetch } = require("../../smart-money/http");
const { finite } = require("../../smart-money/formulas");
const { fetchOpenInterest } = require("../../smart-money/adapters/open-interest");
const {
    appendFundingHist,
    appendOiHist,
    saveDerivatives,
    saveSymbolSnap,
    getSymbolSnap,
    getTickers,
    fundingPercentile,
    loadOiSeries,
} = require("../store");
const { getDashUniverse } = require("../universe");

const MARK_WS = "wss://fstream.binance.com/ws/!markPrice@arr";

/** @type {Map<string, { rate: number, mark: number, at: number }>} */
const markCache = new Map();
/** @type {import('ws').WebSocket|null} */
let markWs = null;
let markDesired = false;
let markReconnect = null;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function priceOiLabel(priceDelta, oiDelta) {
    if (priceDelta == null || oiDelta == null) return null;
    const pUp = priceDelta > 0;
    const pDown = priceDelta < 0;
    const oUp = oiDelta > 0;
    const oDown = oiDelta < 0;
    if (pUp && oUp) return { key: "long_build", label: "Long mới vào" };
    if (pUp && oDown) return { key: "short_squeeze", label: "Short squeeze" };
    if (pDown && oUp) return { key: "short_build", label: "Short mới vào" };
    if (pDown && oDown) return { key: "long_capitulation", label: "Long capitulation" };
    return { key: "flat", label: "Trung tính" };
}

function oiDeltaFromSeries(series, hours) {
    if (!series?.length) return null;
    const now = series[series.length - 1];
    const target = Number(now.ts || now.t) - hours * 3_600_000;
    let best = null;
    for (const row of series) {
        const t = Number(row.ts || row.t);
        if (!Number.isFinite(t)) continue;
        if (t <= target) best = row;
    }
    if (!best) return null;
    const cur = finite(now.qty ?? now.notional);
    const prev = finite(best.qty ?? best.notional);
    if (cur == null || prev == null || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
}

async function fetchGlobalLs(period = "1h") {
    try {
        const { body } = await smartMoneyFetch(
            "futuresData",
            `/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=1`
        );
        const row = Array.isArray(body) ? body[body.length - 1] : null;
        if (!row) return null;
        return {
            longShortRatio: finite(row.longShortRatio),
            longAccount: finite(row.longAccount),
            shortAccount: finite(row.shortAccount),
            timestamp: row.timestamp ? Number(row.timestamp) : null,
        };
    } catch (error) {
        if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") throw error;
        console.warn("[MARKET_DASH] global L/S", error.message || error);
        return null;
    }
}

async function fetchTopTraderLs(symbol = "BTCUSDT", period = "1h") {
    try {
        const { body } = await smartMoneyFetch(
            "futuresData",
            `/futures/data/topLongShortPositionRatio?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=1`
        );
        const row = Array.isArray(body) ? body[body.length - 1] : null;
        if (!row) return null;
        return {
            longShortRatio: finite(row.longShortRatio),
            longAccount: finite(row.longAccount),
            shortAccount: finite(row.shortAccount),
            timestamp: row.timestamp ? Number(row.timestamp) : null,
        };
    } catch (error) {
        if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") throw error;
        console.warn("[MARKET_DASH] top L/S", error.message || error);
        return null;
    }
}

function connectMarkWs() {
    if (!config.useWs || !markDesired) return;
    if (markWs && (markWs.readyState === 0 || markWs.readyState === 1)) return;
    try {
        markWs = new WebSocket(MARK_WS);
    } catch (error) {
        console.warn("[MARKET_DASH] mark WS", error.message || error);
        scheduleMarkReconnect();
        return;
    }
    markWs.on("open", () => console.log("[MARKET_DASH] markPrice WS open"));
    markWs.on("message", (raw) => {
        try {
            const data = JSON.parse(String(raw));
            if (!Array.isArray(data)) return;
            const now = Date.now();
            for (const row of data) {
                const rate = finite(row.r);
                const mark = finite(row.p);
                if (!row.s || rate == null) continue;
                markCache.set(row.s, { rate, mark, at: now });
            }
        } catch (error) {
            console.warn("[MARKET_DASH] mark msg", error.message || error);
        }
    });
    markWs.on("close", () => {
        markWs = null;
        scheduleMarkReconnect();
    });
    markWs.on("error", (e) => console.warn("[MARKET_DASH] mark err", e.message || e));
}

function scheduleMarkReconnect() {
    if (!markDesired || markReconnect) return;
    markReconnect = setTimeout(() => {
        markReconnect = null;
        connectMarkWs();
    }, 5_000);
}

function startMarkWs() {
    markDesired = true;
    connectMarkWs();
}

function stopMarkWs() {
    markDesired = false;
    if (markReconnect) {
        clearTimeout(markReconnect);
        markReconnect = null;
    }
    if (markWs) {
        try {
            markWs.close();
        } catch {
            /* ignore */
        }
        markWs = null;
    }
}

async function ensurePremium(symbol) {
    const cached = markCache.get(symbol);
    if (cached && Date.now() - cached.at < 60_000) return cached;
    const { body } = await smartMoneyFetch(
        "fapi",
        `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
    );
    const rate = finite(body?.lastFundingRate);
    const mark = finite(body?.markPrice);
    const row = { rate, mark, at: Date.now() };
    if (rate != null) markCache.set(symbol, row);
    return row;
}

/**
 * Poll derivatives cho universe (top symbols, stagger).
 */
async function collectDerivatives(opts = {}) {
    const uni = getDashUniverse();
    const symbols = opts.symbols || uni.symbols.slice(0, config.topN);
    const tickers = await getTickers();
    const now = Date.now();
    const coins = [];
    let fundingWeightSum = 0;
    let oiWeightSum = 0;
    let errors = 0;

    const limit = opts.limit || Math.min(symbols.length, 40);
    const batch = symbols.slice(0, limit);

    for (const symbol of batch) {
        try {
            const premium = await ensurePremium(symbol);
            if (premium.rate != null) {
                await appendFundingHist(symbol, now, premium.rate, premium.mark);
            }

            let oi = null;
            try {
                oi = await fetchOpenInterest(symbol, "5m", 30);
            } catch (e) {
                if (e.code === "COOLDOWN" || e.code === "RATE_LIMIT") {
                    console.warn("[MARKET_DASH] OI rate limit, stop batch");
                    break;
                }
                throw e;
            }

            if (oi?.ok && oi.data) {
                const last = oi.data.series?.[oi.data.series.length - 1];
                if (last) {
                    await appendOiHist(
                        symbol,
                        last.t,
                        last.qty,
                        last.notional,
                        "5m"
                    );
                }
            }

            const oiHist = await loadOiSeries(symbol, now - 2 * 24 * 60 * 60_000, "5m");
            const series = oiHist.map((r) => ({
                ts: r.ts instanceof Date ? r.ts.getTime() : Number(r.ts),
                qty: r.qty,
                notional: r.notional,
            }));
            const oiDelta1h = oiDeltaFromSeries(series, 1);
            const oiDelta4h = oiDeltaFromSeries(series, 4);
            const oiDelta24h = oiDeltaFromSeries(series, 24);

            const ticker = tickers.get(symbol);
            const priceDelta24h = ticker?.priceChangePercent ?? null;
            const matrix = priceOiLabel(priceDelta24h, oiDelta24h);

            const pct = await fundingPercentile(symbol, premium.rate, config.histRetentionDays);
            const oiNotional = oi?.data?.notional ?? series[series.length - 1]?.notional ?? null;

            const snap = {
                symbol,
                funding: premium.rate,
                fundingPercentile: pct.percentile,
                fundingSamples: pct.samples,
                fundingBaselineReady: pct.baselineReady,
                markPrice: premium.mark,
                lastPrice: ticker?.lastPrice ?? premium.mark,
                change24h: priceDelta24h,
                quoteVolume: ticker?.quoteVolume ?? null,
                oiQty: oi?.data?.qty ?? series[series.length - 1]?.qty ?? null,
                oiNotional,
                oiDelta1h,
                oiDelta4h,
                oiDelta24h,
                priceOi: matrix,
                updatedAt: new Date().toISOString(),
            };
            await saveSymbolSnap(symbol, snap);
            coins.push(snap);

            if (premium.rate != null && oiNotional != null && oiNotional > 0) {
                fundingWeightSum += premium.rate * oiNotional;
                oiWeightSum += oiNotional;
            }

            await sleep(80);
        } catch (error) {
            errors += 1;
            if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") {
                console.warn("[MARKET_DASH] derivatives cooldown");
                break;
            }
            console.warn(`[MARKET_DASH] deriv ${symbol}`, error.message || error);
        }
    }

    // Bổ sung snap đã có cho symbol ngoài batch (heatmap)
    for (const symbol of symbols) {
        if (coins.find((c) => c.symbol === symbol)) continue;
        const existing = await getSymbolSnap(symbol);
        if (existing) coins.push(existing);
    }

    const top20 = [...coins]
        .filter((c) => c.oiNotional != null)
        .sort((a, b) => (b.oiNotional || 0) - (a.oiNotional || 0))
        .slice(0, 20);

    let weightedFunding = null;
    let wSum = 0;
    let oSum = 0;
    for (const c of top20) {
        if (c.funding != null && c.oiNotional > 0) {
            wSum += c.funding * c.oiNotional;
            oSum += c.oiNotional;
        }
    }
    if (oSum > 0) weightedFunding = wSum / oSum;

    const [globalLs, topLs] = await Promise.all([
        fetchGlobalLs("1h"),
        fetchTopTraderLs("BTCUSDT", "1h"),
    ]);

    const deriv = {
        updatedAt: new Date().toISOString(),
        fundingOiWeightedTop20: weightedFunding,
        fundingSamplesTop20: top20.length,
        globalLongShort: globalLs,
        topTraderLongShort: topLs,
        coinCount: coins.length,
        errors,
        coins: coins.map((c) => ({
            symbol: c.symbol,
            funding: c.funding,
            fundingPercentile: c.fundingPercentile,
            oiDelta1h: c.oiDelta1h,
            oiDelta4h: c.oiDelta4h,
            oiDelta24h: c.oiDelta24h,
            priceOi: c.priceOi,
            change24h: c.change24h,
            quoteVolume: c.quoteVolume,
            lastPrice: c.lastPrice,
        })),
    };
    await saveDerivatives(deriv);
    console.log(
        `[MARKET_DASH] derivatives coins=${coins.length} fundingW=${weightedFunding} errors=${errors}`
    );
    return deriv;
}

module.exports = {
    collectDerivatives,
    startMarkWs,
    stopMarkWs,
    priceOiLabel,
    oiDeltaFromSeries,
    markCache,
};
