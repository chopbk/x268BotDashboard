/**
 * Seed giá/%/volume ngay từ ticker24h — trước khi scoring nến xong.
 */
const { FORMULA_VERSION, SCHEMA_VERSION, TIMEFRAMES, config } = require("./config");

function emptyTimeframes() {
    return Object.fromEntries(
        TIMEFRAMES.map((tf) => [
            tf,
            {
                timeframe: tf,
                formulaVersion: FORMULA_VERSION,
                longScore: null,
                shortScore: null,
                bias: "wait",
                regime: null,
                quality: { overall: "pending", closedBars: 0, minRequired: config.minClosedBars },
                breakdown: [],
                candleCloseTime: null,
                calculatedAt: null,
                dataVersion: null,
            },
        ])
    );
}

function buildPriceSeed({ symbol, ticker = {}, meta = {}, universeVersion = null, now = Date.now() }) {
    const sym = String(symbol).toUpperCase();
    return {
        symbol: sym,
        schemaVersion: SCHEMA_VERSION,
        formulaVersion: FORMULA_VERSION,
        universeVersion,
        calculatedAt: new Date(now).toISOString(),
        qualityOverall: "pending",
        phase: "price",
        inTop: meta.inTop !== false,
        volumeRank: meta.volumeRank ?? null,
        price: {
            last: ticker.lastPrice ?? meta.lastPrice ?? null,
            changePct24h: ticker.priceChangePercent ?? meta.priceChangePercent ?? null,
            volume24h: ticker.quoteVolume ?? meta.quoteVolume ?? null,
        },
        timeframes: emptyTimeframes(),
        composites: {},
        links: {
            smartMoney: `/smart-money?symbol=${sym}`,
            terminal: `/terminal?symbol=${sym}`,
        },
    };
}

function hasScoredFrames(snapshot) {
    if (!snapshot?.timeframes) return false;
    return TIMEFRAMES.some((tf) => {
        const f = snapshot.timeframes[tf];
        return f && (f.longScore != null || f.shortScore != null || f.quality?.overall === "ready");
    });
}

function applyTickerPrice(snapshot, ticker = {}, meta = {}) {
    if (!snapshot) return snapshot;
    const next = { ...snapshot };
    next.price = {
        last: ticker.lastPrice ?? meta.lastPrice ?? snapshot.price?.last ?? null,
        changePct24h:
            ticker.priceChangePercent ?? meta.priceChangePercent ?? snapshot.price?.changePct24h ?? null,
        volume24h: ticker.quoteVolume ?? meta.quoteVolume ?? snapshot.price?.volume24h ?? null,
    };
    if (meta.volumeRank != null) next.volumeRank = meta.volumeRank;
    if (meta.inTop != null) next.inTop = meta.inTop !== false;
    return next;
}

/**
 * Ước lượng thời gian còn lại (giây) — fapi gap ~400ms, 5 TF/symbol, batch + tick.
 */
function estimateEtaSeconds({ remainingSymbols, bootstrap = true }) {
    const left = Math.max(0, Number(remainingSymbols) || 0);
    if (left === 0) return 0;
    const gapMs = 400;
    const tfs = TIMEFRAMES.length;
    const concurrency = Math.max(1, config.fetchConcurrency);
    const batch = bootstrap ? 8 : 20;
    const requests = left * tfs;
    const fetchMs = (requests / concurrency) * gapMs;
    const cycles = Math.ceil(left / batch);
    const tickWait = Math.max(0, cycles - 1) * config.schedulerTickMs * 0.35;
    return Math.ceil((fetchMs + tickWait) / 1000);
}

module.exports = {
    buildPriceSeed,
    hasScoredFrames,
    applyTickerPrice,
    estimateEtaSeconds,
    emptyTimeframes,
};
