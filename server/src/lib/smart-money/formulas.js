/**
 * Công thức Smart Money — thiếu dữ liệu trả null, không ép 0.
 */

function finite(value) {
    if (value == null || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function deltaQty(newer, older) {
    const a = finite(newer);
    const b = finite(older);
    if (a == null || b == null) return null;
    return a - b;
}

function deltaPct(newer, older) {
    const d = deltaQty(newer, older);
    const b = finite(older);
    if (d == null || b == null || !(b > 0)) return null;
    return (d / b) * 100;
}

/** Delta tỷ lệ (điểm phần trăm), không phải phần trăm tương đối. */
function deltaRatioPoints(newerPct, olderPct) {
    const a = finite(newerPct);
    const b = finite(olderPct);
    if (a == null || b == null) return null;
    return a - b;
}

function profitRatioPct(profitCount, totalCount) {
    const p = finite(profitCount);
    const t = finite(totalCount);
    if (p == null || t == null || !(t > 0)) return null;
    return (p / t) * 100;
}

/**
 * Khoảng cách giá tới entry trung bình (%). Không phải ROE có leverage.
 * side: LONG → dương khi mark > entry; SHORT → dương khi mark < entry (lợi thế side).
 */
function distanceToEntryPct(mark, avgEntry, side = null) {
    const m = finite(mark);
    const e = finite(avgEntry);
    if (m == null || e == null || !(e > 0)) return null;
    const raw = ((m - e) / e) * 100;
    const s = String(side || "").toUpperCase();
    if (s === "SHORT") return -raw;
    if (s === "LONG") return raw;
    return raw;
}

function notionalFromQtyPrice(qty, price) {
    const q = finite(qty);
    const p = finite(price);
    if (q == null || p == null) return null;
    return q * p;
}

/**
 * Funding cost ước tính một kỳ — longPays khi rate > 0.
 * @returns {null|{ rate, intervalHours, perSettlementUsd, longPays, assumption }}
 */
function fundingCostEstimate(rate, notionalUsd, intervalHours, side = null) {
    const r = finite(rate);
    const n = finite(notionalUsd);
    const h = finite(intervalHours);
    if (r == null || n == null || !(n > 0)) return null;
    const hours = h != null && h > 0 ? h : null;
    const per = n * r;
    const s = String(side || "").toUpperCase();
    let signedForSide = null;
    if (s === "LONG") signedForSide = per;
    else if (s === "SHORT") signedForSide = -per;
    return {
        rate: r,
        intervalHours: hours,
        perSettlementUsd: per,
        signedForSide,
        longPays: r > 0,
        assumption: hours == null
            ? "Chưa biết interval funding của symbol; chi phí theo một kỳ rate hiện tại."
            : `Ước tính theo kỳ ${hours}h hiện tại — không phải lợi suất bảo đảm.`,
    };
}

function mean(values) {
    const xs = (values || []).map(finite).filter((v) => v != null);
    if (!xs.length) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(values) {
    const xs = (values || []).map(finite).filter((v) => v != null);
    if (xs.length < 2) return null;
    const m = mean(xs);
    if (m == null) return null;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(v);
}

function zScore(value, samples) {
    const x = finite(value);
    const m = mean(samples);
    const sd = stddev(samples);
    if (x == null || m == null || sd == null || !(sd > 0)) return null;
    return (x - m) / sd;
}

function biasFromLongShort(longQty, shortQty) {
    const L = finite(longQty);
    const S = finite(shortQty);
    if (L == null && S == null) return "unclear";
    if (L != null && S == null) return L > 0 ? "long" : "unclear";
    if (S != null && L == null) return S > 0 ? "short" : "unclear";
    if (!(L > 0) && !(S > 0)) return "unclear";
    const ratio = L / Math.max(S, 1e-12);
    if (ratio >= 1.15) return "long";
    if (ratio <= 1 / 1.15) return "short";
    return "both";
}

module.exports = {
    finite,
    deltaQty,
    deltaPct,
    deltaRatioPoints,
    profitRatioPct,
    distanceToEntryPct,
    notionalFromQtyPrice,
    fundingCostEstimate,
    mean,
    stddev,
    zScore,
    biasFromLongShort,
};
