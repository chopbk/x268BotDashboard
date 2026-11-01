const { loadClosedCandles } = require("./market/candles");
const { envelope, nowMs } = require("./provenance");
const { ALLOWED_TF } = require("./terminal-workspace");
const { httpError } = require("./http");

/**
 * Candles cho Terminal chart — reuse market candle loader + provenance.
 * Không nối credential account; public klines qua limiter hiện có.
 */
async function getTerminalCandles({ symbol, timeframe = "15m", limit = 120, fetchImpl } = {}) {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) throw httpError(400, "Thiếu symbol");
    const tf = String(timeframe || "15m");
    if (!ALLOWED_TF.has(tf)) throw httpError(400, `timeframe không hỗ trợ: ${tf}`);

    const receivedAt = nowMs();
    let loaded;
    try {
        loaded = await loadClosedCandles(sym, tf, { limit, fetchImpl });
    } catch (error) {
        return {
            exchange: "binance",
            marketType: "usdt_perp_linear",
            instrumentId: sym,
            symbol: sym,
            timeframe: tf,
            candles: [],
            provenance: envelope({
                source: "market.candles",
                receivedAt,
                computedAt: nowMs(),
                quality: "missing",
                missingFields: ["candles"],
                coverage: { error: error.message || "fetch_failed" },
            }),
        };
    }

    const closed = (loaded.closed || []).slice(-Math.min(500, Math.max(20, Number(limit) || 120)));
    const candles = closed.map((c) => ({
        time: Math.floor(Number(c.openTime) / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
    const sourceAt = closed.length ? Number(closed[closed.length - 1].closeTime) : null;

    return {
        exchange: "binance",
        marketType: "usdt_perp_linear",
        instrumentId: sym,
        symbol: sym,
        timeframe: tf,
        candles,
        forming: Boolean(loaded.formingCandle),
        provenance: envelope({
            source: "market.candles",
            sourceAt,
            receivedAt,
            computedAt: nowMs(),
            quality: candles.length ? (loaded.formingCandle ? "partial" : "fresh") : "missing",
            missingFields: candles.length ? [] : ["candles"],
            coverage: {
                closedBars: candles.length,
                forming: Boolean(loaded.formingCandle),
                note: "closed_candles_only",
            },
            expiresAt: receivedAt + 60_000,
        }),
    };
}

module.exports = { getTerminalCandles };
