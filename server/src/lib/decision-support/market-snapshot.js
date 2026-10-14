/**
 * Snapshot thị trường đa khung cho decision-support.
 * Ưu tiên nến đã đóng; đánh dấu formingCandle.
 */
const {
    ema,
    atr,
    findSwings,
    structureBias,
    parseKlines,
    roundPrice,
} = require("../market-structure");
const { binancePublicFetch } = require("../binance-peer-proxy");

const HOST = "https://fapi.binance.com";
const cache = new Map();
const CACHE_MS = 60_000;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function rsi(closes, period = 14) {
    if (!closes || closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d;
        else losses -= d;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i += 1) {
        const d = closes[i] - closes[i - 1];
        const gain = d > 0 ? d : 0;
        const loss = d < 0 ? -d : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return roundPrice(100 - 100 / (1 + rs), 2);
}

function relativeVolume(candles, lookback = 20) {
    if (!candles || candles.length < lookback + 1) return null;
    const closed = candles.slice(0, -1);
    const recent = closed.slice(-lookback);
    const avg = recent.reduce((s, c) => s + (c.volume || 0), 0) / recent.length;
    const lastClosed = closed[closed.length - 1];
    if (!(avg > 0) || !lastClosed) return null;
    return roundPrice(lastClosed.volume / avg, 2);
}

async function fetchKlines(symbol, interval, limit, fetchImpl) {
    const key = `${symbol}|${interval}|${limit}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    const url = `${HOST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
        const err = new Error(body?.msg || `Không lấy được klines ${symbol} ${interval}`);
        err.statusCode = res.status || 502;
        throw err;
    }
    const candles = parseKlines(body);
    const payload = { at: Date.now(), candles, rawAt: new Date().toISOString() };
    cache.set(key, payload);
    return payload;
}

function frameMetrics(candles, intervalMs) {
    if (!candles || candles.length < 30) return { error: "Không đủ nến", intervalMs };
    const now = Date.now();
    const last = candles[candles.length - 1];
    const forming = last && intervalMs > 0 && now < last.openTime + intervalMs;
    const closedCandles = forming ? candles.slice(0, -1) : candles;
    const closes = closedCandles.map((c) => c.close);
    const swings = findSwings(closedCandles, 2);
    const structure = structureBias(swings.highs, swings.lows);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const atr14 = atr(closedCandles, 14);
    const rsi14 = rsi(closes, 14);
    const volRel = relativeVolume(candles, 20);
    const lastClose = closes[closes.length - 1];
    const recentHigh = Math.max(...closedCandles.slice(-20).map((c) => c.high));
    const recentLow = Math.min(...closedCandles.slice(-20).map((c) => c.low));
    const swingHigh = swings.highs.length ? swings.highs[swings.highs.length - 1].price : recentHigh;
    const swingLow = swings.lows.length ? swings.lows[swings.lows.length - 1].price : recentLow;
    let trendVsEma = "neutral";
    if (ema20 != null && ema50 != null && lastClose != null) {
        if (lastClose > ema20 && ema20 > ema50) trendVsEma = "bullish";
        else if (lastClose < ema20 && ema20 < ema50) trendVsEma = "bearish";
        else if (lastClose > ema20) trendVsEma = "short_bull";
        else if (lastClose < ema20) trendVsEma = "short_bear";
    }
    return {
        lastClose: roundPrice(lastClose),
        ema20: roundPrice(ema20),
        ema50: roundPrice(ema50),
        atr14: roundPrice(atr14),
        atrPct: atr14 != null && lastClose ? roundPrice((atr14 / lastClose) * 100, 3) : null,
        rsi14,
        volumeRel: volRel,
        structure,
        trendVsEma,
        support: roundPrice(Math.min(swingLow, recentLow)),
        resistance: roundPrice(Math.max(swingHigh, recentHigh)),
        swingHigh: roundPrice(swingHigh),
        swingLow: roundPrice(swingLow),
        formingCandle: Boolean(forming),
        closedBars: closedCandles.length,
        method: "swing_pivot_lookback2 + EMA20/50 + ATR14 + RSI14 + vol/avg20 trên nến đã đóng",
    };
}

const INTERVAL_MS = { "15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000 };

async function buildMarketSnapshot(symbol, opts = {}) {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return { error: "Thiếu symbol" };
    const fetchImpl = opts.fetchImpl || binancePublicFetch;
    const side = String(opts.side || "").toUpperCase();

    const tasks = [
        fetchKlines(sym, "15m", 120, fetchImpl),
        fetchKlines(sym, "1h", 100, fetchImpl),
        fetchKlines(sym, "4h", 80, fetchImpl),
    ];
    const isAlt = sym !== "BTCUSDT" && sym.endsWith("USDT");
    if (isAlt) tasks.push(fetchKlines("BTCUSDT", "1h", 100, fetchImpl));

    let packs;
    try {
        packs = await Promise.all(tasks);
    } catch (error) {
        return { symbol: sym, error: error.message || "Không lấy được nến", asOf: new Date().toISOString() };
    }

    const tf15 = frameMetrics(packs[0].candles, INTERVAL_MS["15m"]);
    const tf1h = frameMetrics(packs[1].candles, INTERVAL_MS["1h"]);
    const tf4h = frameMetrics(packs[2].candles, INTERVAL_MS["4h"]);
    const btc = isAlt && packs[3] ? frameMetrics(packs[3].candles, INTERVAL_MS["1h"]) : null;

    const biases = [tf15.structure?.bias, tf1h.structure?.bias, tf4h.structure?.bias].filter(Boolean);
    const bull = biases.filter((b) => b === "bullish").length;
    const bear = biases.filter((b) => b === "bearish").length;
    let multiTf = "unclear";
    if (bull >= 2 && bear === 0) multiTf = "bullish_align";
    else if (bear >= 2 && bull === 0) multiTf = "bearish_align";
    else if (bull && bear) multiTf = "conflict";

    let alignment = "neutral";
    if (side === "LONG") {
        if (multiTf === "bullish_align" || tf4h.trendVsEma === "bullish") alignment = "with";
        if (multiTf === "bearish_align" || tf4h.trendVsEma === "bearish") alignment = "against";
    } else if (side === "SHORT") {
        if (multiTf === "bearish_align" || tf4h.trendVsEma === "bearish") alignment = "with";
        if (multiTf === "bullish_align" || tf4h.trendVsEma === "bullish") alignment = "against";
    }

    const atr14 = tf15.atr14 ?? tf1h.atr14;
    const mark = num(opts.mark) ?? tf15.lastClose;
    const entry = num(opts.entry);
    const levels = [];
    if (side === "LONG" || side === "SHORT") {
        const refSl = entry != null ? entry : mark;
        const refTp = mark;
        if (side === "LONG") {
            if (tf15.support != null && (mark == null || tf15.support < mark)) {
                levels.push({ id: "sl_support", role: "sl", price: tf15.support, label: "SL dưới hỗ trợ 15m", tf: "15m" });
            }
            if (atr14 != null && refSl != null) {
                const p = roundPrice(refSl - 1.5 * atr14);
                if (p != null && (mark == null || p < mark)) {
                    levels.push({ id: "sl_atr", role: "sl", price: p, label: "SL 1.5×ATR(15m)", tf: "15m" });
                }
            }
            if (atr14 != null && refTp != null) {
                levels.push({ id: "tp1", role: "tp", price: roundPrice(refTp + atr14), label: "TP1 1×ATR từ mark", tf: "15m" });
                levels.push({ id: "tp2", role: "tp", price: roundPrice(refTp + 2 * atr14), label: "TP2 2×ATR từ mark", tf: "15m" });
            }
            if (tf1h.resistance != null && (mark == null || tf1h.resistance > mark)) {
                levels.push({ id: "tp_res_1h", role: "tp", price: tf1h.resistance, label: "TP kháng cự 1h", tf: "1h" });
            }
            levels.push({ id: "zone_sup", role: "zone", price: tf15.support, label: "Vùng hỗ trợ 15m", tf: "15m" });
            levels.push({ id: "zone_res", role: "zone", price: tf15.resistance, label: "Vùng kháng cự 15m", tf: "15m" });
        } else {
            if (tf15.resistance != null && (mark == null || tf15.resistance > mark)) {
                levels.push({ id: "sl_resistance", role: "sl", price: tf15.resistance, label: "SL trên kháng cự 15m", tf: "15m" });
            }
            if (atr14 != null && refSl != null) {
                const p = roundPrice(refSl + 1.5 * atr14);
                if (p != null && (mark == null || p > mark)) {
                    levels.push({ id: "sl_atr", role: "sl", price: p, label: "SL 1.5×ATR(15m)", tf: "15m" });
                }
            }
            if (atr14 != null && refTp != null) {
                levels.push({ id: "tp1", role: "tp", price: roundPrice(refTp - atr14), label: "TP1 1×ATR từ mark", tf: "15m" });
                levels.push({ id: "tp2", role: "tp", price: roundPrice(refTp - 2 * atr14), label: "TP2 2×ATR từ mark", tf: "15m" });
            }
            if (tf1h.support != null && (mark == null || tf1h.support < mark)) {
                levels.push({ id: "tp_sup_1h", role: "tp", price: tf1h.support, label: "TP hỗ trợ 1h", tf: "1h" });
            }
            levels.push({ id: "zone_res", role: "zone", price: tf15.resistance, label: "Vùng kháng cự 15m", tf: "15m" });
            levels.push({ id: "zone_sup", role: "zone", price: tf15.support, label: "Vùng hỗ trợ 15m", tf: "15m" });
        }
    }

    const candidateLevels = {
        swingHigh: tf15.swingHigh ?? tf1h.swingHigh,
        swingLow: tf15.swingLow ?? tf1h.swingLow,
        structureSlLong: tf15.support ?? tf1h.support,
        structureSlShort: tf15.resistance ?? tf1h.resistance,
        structureTpLong: tf1h.resistance ?? tf15.resistance,
        structureTpShort: tf1h.support ?? tf15.support,
        invalidation: side === "LONG"
            ? (tf15.swingLow ?? tf15.support)
            : side === "SHORT"
                ? (tf15.swingHigh ?? tf15.resistance)
                : null,
    };

    return {
        symbol: sym,
        asOf: new Date().toISOString(),
        source: "binance_fapi_public",
        tf15,
        tf1h,
        tf4h,
        btc1h: btc,
        multiTf,
        alignment,
        atr14,
        levels: levels.filter((l) => l.price != null).slice(0, 10),
        candidateLevels,
        note: "Chỉ báo trên nến đã đóng khi có thể; formingCandle=true nghĩa là nến cuối chưa đóng.",
    };
}

function multiTfLabel(multiTf) {
    if (multiTf === "bullish_align") return "đồng thuận tăng trên nhiều khung";
    if (multiTf === "bearish_align") return "đồng thuận giảm trên nhiều khung";
    if (multiTf === "conflict") return "các khung đang xung đột";
    return "xu hướng đa khung chưa rõ";
}

function alignmentLabel(alignment, side) {
    const s = String(side || "").toUpperCase();
    const sideBit = s ? ` ${s}` : "";
    if (alignment === "with") return `side${sideBit} thuận xu hướng`;
    if (alignment === "against") return `side${sideBit} ngược xu hướng`;
    return `side${sideBit} trung lập với xu hướng`;
}

function trendLabel(trend) {
    if (trend === "bullish") return "tăng (giá trên EMA20 > EMA50)";
    if (trend === "bearish") return "giảm (giá dưới EMA20 < EMA50)";
    if (trend === "short_bull") return "ngắn hạn tăng (giá trên EMA20)";
    if (trend === "short_bear") return "ngắn hạn giảm (giá dưới EMA20)";
    return "trung lập";
}

/**
 * Tóm tắt kỹ thuật + findings luôn có khi đủ nến — để báo cáo/UI không chỉ nói rủi ro lệnh.
 */
function buildTechnicalBrief(market, { side = null, symbol = null } = {}) {
    if (!market || market.error) {
        return {
            headline: null,
            findings: market?.error
                ? [{
                    title: "Chưa lấy được nến",
                    detail: String(market.error),
                    evidence: "market_error",
                    severity: "info",
                }]
                : [],
            cards: null,
        };
    }

    const sym = symbol || market.symbol || "";
    const tf15 = market.tf15 || {};
    const tf1h = market.tf1h || {};
    const tf4h = market.tf4h || {};
    const btc = market.btc1h || null;
    const findings = [];

    const struct15 = tf15.structure?.label || "—";
    const struct1h = tf1h.structure?.label || "—";
    const struct4h = tf4h.structure?.label || "—";

    findings.push({
        title: "Cấu trúc đa khung",
        detail: `15m: ${struct15}. 1h: ${struct1h}. 4h: ${struct4h}. Tổng thể ${multiTfLabel(market.multiTf)}.`,
        evidence: `multiTf=${market.multiTf}`,
        severity: market.multiTf === "conflict" ? "warn" : "info",
    });

    findings.push({
        title: "Khớp với hướng lệnh",
        detail: `Xu hướng đang ${alignmentLabel(market.alignment, side)}. 4h ${trendLabel(tf4h.trendVsEma)}.`,
        evidence: `alignment=${market.alignment}`,
        severity: market.alignment === "against" ? "warn" : "info",
    });

    if (tf15.rsi14 != null) {
        let rsiTone = "info";
        let rsiNote = "vùng trung tính";
        if (tf15.rsi14 >= 70) {
            rsiTone = "warn";
            rsiNote = "vùng quá mua";
        } else if (tf15.rsi14 <= 30) {
            rsiTone = "warn";
            rsiNote = "vùng quá bán";
        }
        findings.push({
            title: "RSI và biến động",
            detail: `RSI 15m ≈ ${tf15.rsi14} (${rsiNote}). ATR ≈ ${tf15.atr14 ?? market.atr14 ?? "—"}`
                + (tf15.atrPct != null ? ` (~${tf15.atrPct}% giá)` : "")
                + (tf15.volumeRel != null ? `; khối lượng nến đóng ≈ ${tf15.volumeRel}× trung bình` : "")
                + ".",
            evidence: `rsi15=${tf15.rsi14};atr=${tf15.atr14}`,
            severity: rsiTone,
        });
    }

    const support = tf15.support ?? tf1h.support;
    const resistance = tf15.resistance ?? tf1h.resistance;
    if (support != null || resistance != null) {
        findings.push({
            title: "Vùng hỗ trợ – kháng cự",
            detail: [
                support != null ? `Hỗ trợ gần ≈ ${support}` : null,
                resistance != null ? `kháng cự gần ≈ ${resistance}` : null,
                market.candidateLevels?.invalidation != null
                    ? `mức hủy luận điểm ≈ ${market.candidateLevels.invalidation}`
                    : null,
            ].filter(Boolean).join("; ") + ".",
            evidence: "candidateLevels",
            severity: "info",
        });
    }

    if (btc && !btc.error) {
        findings.push({
            title: "Bối cảnh BTC",
            detail: `BTC 1h: ${btc.structure?.label || "—"}, xu hướng ${trendLabel(btc.trendVsEma)}.`,
            evidence: `btc_trend=${btc.trendVsEma}`,
            severity: "info",
        });
    }

    const forming = [tf15.formingCandle && "15m", tf1h.formingCandle && "1h", tf4h.formingCandle && "4h"]
        .filter(Boolean);
    if (forming.length) {
        findings.push({
            title: "Nến đang chạy",
            detail: `Khung ${forming.join(", ")} chưa đóng — tín hiệu khung đó có thể đổi khi đóng nến.`,
            evidence: "formingCandle",
            severity: "info",
        });
    }

    const headline = [
        sym || null,
        multiTfLabel(market.multiTf),
        side ? alignmentLabel(market.alignment, side) : null,
    ].filter(Boolean).join(" · ");

    return {
        headline,
        findings: findings.slice(0, 6),
        cards: {
            multiTf: market.multiTf,
            multiTfLabel: multiTfLabel(market.multiTf),
            alignment: market.alignment,
            alignmentLabel: alignmentLabel(market.alignment, side),
            atr14: market.atr14 ?? tf15.atr14,
            atrPct: tf15.atrPct ?? tf1h.atrPct,
            rsi15: tf15.rsi14,
            rsi1h: tf1h.rsi14,
            structure15: struct15,
            structure1h: struct1h,
            structure4h: struct4h,
            trend4h: trendLabel(tf4h.trendVsEma),
            support,
            resistance,
            invalidation: market.candidateLevels?.invalidation ?? null,
            volumeRel15: tf15.volumeRel,
            forming: forming,
            btcTrend: btc && !btc.error ? trendLabel(btc.trendVsEma) : null,
            btcStructure: btc && !btc.error ? (btc.structure?.label || null) : null,
            levels: (market.levels || []).slice(0, 8),
            note: market.note,
        },
    };
}

module.exports = {
    buildMarketSnapshot,
    buildTechnicalBrief,
    multiTfLabel,
    alignmentLabel,
    frameMetrics,
    rsi,
    relativeVolume,
};
