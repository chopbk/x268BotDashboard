/**
 * Phân tích kỹ thuật tối thiểu từ klines public Binance Futures.
 * Không cần API key. Cache ngắn để tránh spam.
 */
const { binancePublicFetch } = require("./binance-peer-proxy");

const HOST = "https://fapi.binance.com";
const cache = new Map();
const CACHE_MS = 60_000;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function roundPrice(value, digits = 6) {
    const n = num(value);
    if (n == null) return null;
    const abs = Math.abs(n);
    const d = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : digits;
    return Number(n.toFixed(d));
}

function ema(closes, period) {
    if (!closes?.length || closes.length < period) return null;
    const k = 2 / (period + 1);
    let value = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i += 1) value = closes[i] * k + value * (1 - k);
    return value;
}

function atr(candles, period = 14) {
    if (!candles?.length || candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i += 1) {
        const cur = candles[i];
        const prev = candles[i - 1];
        const tr = Math.max(
            cur.high - cur.low,
            Math.abs(cur.high - prev.close),
            Math.abs(cur.low - prev.close)
        );
        trs.push(tr);
    }
    if (trs.length < period) return null;
    let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i += 1) value = (value * (period - 1) + trs[i]) / period;
    return value;
}

/** Pivot swing: high/low lớn hơn (nhỏ hơn) 2 nến mỗi bên. */
function findSwings(candles, lookback = 2) {
    const highs = [];
    const lows = [];
    for (let i = lookback; i < candles.length - lookback; i += 1) {
        const c = candles[i];
        let isHigh = true;
        let isLow = true;
        for (let j = 1; j <= lookback; j += 1) {
            if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
            if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) isLow = false;
        }
        if (isHigh) highs.push({ index: i, price: c.high, time: c.openTime });
        if (isLow) lows.push({ index: i, price: c.low, time: c.openTime });
    }
    return { highs, lows };
}

function structureBias(highs, lows) {
    const h = highs.slice(-3);
    const l = lows.slice(-3);
    if (h.length < 2 || l.length < 2) return { bias: "unknown", label: "Chưa đủ swing" };
    const hh = h[h.length - 1].price > h[h.length - 2].price;
    const hl = l[l.length - 1].price > l[l.length - 2].price;
    const lh = h[h.length - 1].price < h[h.length - 2].price;
    const ll = l[l.length - 1].price < l[l.length - 2].price;
    if (hh && hl) return { bias: "bullish", label: "Cấu trúc tăng (HH+HL)" };
    if (lh && ll) return { bias: "bearish", label: "Cấu trúc giảm (LH+LL)" };
    if (hh && ll) return { bias: "expanding", label: "Mở rộng (HH+LL) — biến động lớn" };
    if (lh && hl) return { bias: "contracting", label: "Thắt (LH+HL) — range" };
    return { bias: "mixed", label: "Cấu trúc lẫn" };
}

function parseKlines(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => ({
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
    })).filter((c) => Number.isFinite(c.close));
}

async function fetchKlines(symbol, interval, limit, fetchImpl) {
    const key = `${symbol}|${interval}|${limit}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.candles;
    const url = `${HOST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
        const err = new Error(body?.msg || `Không lấy được klines ${symbol} ${interval}`);
        err.statusCode = res.status || 502;
        throw err;
    }
    const candles = parseKlines(body);
    cache.set(key, { at: Date.now(), candles });
    return candles;
}

/**
 * @param {string} symbol
 * @param {{ side?: string, entry?: number, mark?: number, fetchImpl?: typeof fetch }} opts
 */
async function analyzeMarketStructure(symbol, opts = {}) {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym || sym.length < 4) return null;
    const fetchImpl = opts.fetchImpl || binancePublicFetch;
    const side = String(opts.side || "").toUpperCase();
    const entry = num(opts.entry);
    const mark = num(opts.mark);

    const [c15, c1h] = await Promise.all([
        fetchKlines(sym, "15m", 120, fetchImpl),
        fetchKlines(sym, "1h", 80, fetchImpl),
    ]);
    if (c15.length < 30) return { symbol: sym, error: "Không đủ nến 15m" };

    const closes15 = c15.map((c) => c.close);
    const ema20 = ema(closes15, 20);
    const ema50 = ema(closes15, 50);
    const atr14 = atr(c15, 14);
    const last = c15[c15.length - 1];
    const lastClose = last?.close ?? mark;
    const swings15 = findSwings(c15, 2);
    const swings1h = findSwings(c1h, 2);
    const struct15 = structureBias(swings15.highs, swings15.lows);
    const struct1h = structureBias(swings1h.highs, swings1h.lows);

    const recentHigh = Math.max(...c15.slice(-20).map((c) => c.high));
    const recentLow = Math.min(...c15.slice(-20).map((c) => c.low));
    const swingHigh = swings15.highs.length ? swings15.highs[swings15.highs.length - 1].price : recentHigh;
    const swingLow = swings15.lows.length ? swings15.lows[swings15.lows.length - 1].price : recentLow;

    const resistance = roundPrice(Math.max(swingHigh, recentHigh));
    const support = roundPrice(Math.min(swingLow, recentLow));

    let trendVsEma = "neutral";
    if (ema20 != null && ema50 != null && lastClose != null) {
        if (lastClose > ema20 && ema20 > ema50) trendVsEma = "bullish";
        else if (lastClose < ema20 && ema20 < ema50) trendVsEma = "bearish";
        else if (lastClose > ema20) trendVsEma = "short_bull";
        else if (lastClose < ema20) trendVsEma = "short_bear";
    }

    const atrR = roundPrice(atr14);
    const levels = [];
    // SL neo quanh entry (hoặc mark); TP phía có lợi từ mark hiện tại.
    const refSl = entry != null ? entry : (mark != null ? mark : lastClose);
    const refTp = mark != null ? mark : (entry != null ? entry : lastClose);

    if (side === "LONG") {
        const slSwing = roundPrice(support);
        const slAtr = atr14 != null && refSl != null ? roundPrice(refSl - 1.5 * atr14) : null;
        const tp1 = atr14 != null && refTp != null ? roundPrice(refTp + 1 * atr14) : roundPrice(resistance);
        const tp2 = atr14 != null && refTp != null ? roundPrice(refTp + 2 * atr14) : null;
        const tpRes = resistance != null && (mark == null || resistance > mark) ? resistance : null;
        if (slSwing != null && (mark == null || slSwing < mark)) {
            levels.push({
                id: "sl_support",
                role: "sl",
                label: "SL dưới hỗ trợ 15m",
                price: slSwing,
                reason: "Swing/low gần nhất làm vùng stoploss",
            });
        }
        if (slAtr != null && (mark == null || slAtr < mark) && slAtr !== slSwing) {
            levels.push({
                id: "sl_atr",
                role: "sl",
                label: "SL ~1.5×ATR(15m)",
                price: slAtr,
                reason: "Khoảng ATR14 dưới entry (hoặc mark nếu chưa có entry)",
            });
        }
        if (tp1 != null && (mark == null || tp1 > mark)) {
            levels.push({
                id: "tp1",
                role: "tp",
                label: "TP1 ~1×ATR phía trên mark",
                price: tp1,
                reason: "Mục tiêu gần từ giá hiện tại — chốt một phần",
            });
        }
        if (tp2 != null && (mark == null || tp2 > mark)) {
            levels.push({
                id: "tp2",
                role: "tp",
                label: "TP2 ~2×ATR phía trên mark",
                price: tp2,
                reason: "Mục tiêu xa hơn nếu cấu trúc còn tăng",
            });
        }
        if (tpRes != null && tpRes !== tp1 && tpRes !== tp2) {
            levels.push({
                id: "tp_resistance",
                role: "tp",
                label: "TP tại kháng cự 15m",
                price: tpRes,
                reason: "Kháng cự gần phía trên mark",
            });
        }
        if (support != null) {
            levels.push({
                id: "buy_zone",
                role: "zone",
                label: "Vùng mua / hỗ trợ",
                price: support,
                reason: "Hỗ trợ 15m gần — tham chiếu DCA hoặc invalidation",
            });
        }
        if (resistance != null) {
            levels.push({
                id: "sell_zone",
                role: "zone",
                label: "Vùng bán / kháng cự",
                price: resistance,
                reason: "Kháng cự 15m gần — nơi áp lực chốt lời",
            });
        }
    } else if (side === "SHORT") {
        const slSwing = roundPrice(resistance);
        const slAtr = atr14 != null && refSl != null ? roundPrice(refSl + 1.5 * atr14) : null;
        const tp1 = atr14 != null && refTp != null ? roundPrice(refTp - 1 * atr14) : roundPrice(support);
        const tp2 = atr14 != null && refTp != null ? roundPrice(refTp - 2 * atr14) : null;
        const tpSup = support != null && (mark == null || support < mark) ? support : null;
        if (slSwing != null && (mark == null || slSwing > mark)) {
            levels.push({
                id: "sl_resistance",
                role: "sl",
                label: "SL trên kháng cự 15m",
                price: slSwing,
                reason: "Swing/high gần nhất làm vùng stoploss",
            });
        }
        if (slAtr != null && (mark == null || slAtr > mark) && slAtr !== slSwing) {
            levels.push({
                id: "sl_atr",
                role: "sl",
                label: "SL ~1.5×ATR(15m)",
                price: slAtr,
                reason: "Khoảng ATR14 trên entry (hoặc mark nếu chưa có entry)",
            });
        }
        if (tp1 != null && (mark == null || tp1 < mark)) {
            levels.push({
                id: "tp1",
                role: "tp",
                label: "TP1 ~1×ATR phía dưới mark",
                price: tp1,
                reason: "Mục tiêu gần từ giá hiện tại — chốt một phần",
            });
        }
        if (tp2 != null && (mark == null || tp2 < mark)) {
            levels.push({
                id: "tp2",
                role: "tp",
                label: "TP2 ~2×ATR phía dưới mark",
                price: tp2,
                reason: "Mục tiêu xa hơn nếu cấu trúc còn giảm",
            });
        }
        if (tpSup != null && tpSup !== tp1 && tpSup !== tp2) {
            levels.push({
                id: "tp_support",
                role: "tp",
                label: "TP tại hỗ trợ 15m",
                price: tpSup,
                reason: "Hỗ trợ gần phía dưới mark",
            });
        }
        if (resistance != null) {
            levels.push({
                id: "sell_zone",
                role: "zone",
                label: "Vùng bán / kháng cự",
                price: resistance,
                reason: "Kháng cự 15m — vùng thêm short / invalidation trên",
            });
        }
        if (support != null) {
            levels.push({
                id: "buy_zone",
                role: "zone",
                label: "Vùng mua / hỗ trợ",
                price: support,
                reason: "Hỗ trợ 15m — nơi áp lực mua che short",
            });
        }
    }

    const aligned = (side === "LONG" && (struct15.bias === "bullish" || trendVsEma === "bullish"))
        || (side === "SHORT" && (struct15.bias === "bearish" || trendVsEma === "bearish"));
    const against = (side === "LONG" && (struct15.bias === "bearish" || trendVsEma === "bearish"))
        || (side === "SHORT" && (struct15.bias === "bullish" || trendVsEma === "bullish"));

    return {
        symbol: sym,
        intervalPrimary: "15m",
        intervalHigher: "1h",
        lastClose: roundPrice(lastClose),
        ema20: roundPrice(ema20),
        ema50: roundPrice(ema50),
        atr14: atrR,
        atrPct: atr14 != null && lastClose ? roundPrice((atr14 / lastClose) * 100, 3) : null,
        trendVsEma,
        structure15: struct15,
        structure1h: struct1h,
        support,
        resistance,
        swingHigh: roundPrice(swingHigh),
        swingLow: roundPrice(swingLow),
        alignment: against ? "against" : aligned ? "with" : "neutral",
        levels: levels.slice(0, 8),
        note: "Ước tính từ nến futures công khai; không phải tín hiệu chắc chắn. Áp dụng vẫn qua confirm TP/SL.",
        at: new Date().toISOString(),
    };
}

module.exports = {
    analyzeMarketStructure,
    ema,
    atr,
    findSwings,
    structureBias,
    parseKlines,
    roundPrice,
};
