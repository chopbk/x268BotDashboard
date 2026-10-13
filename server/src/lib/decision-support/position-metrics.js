const TAKER_FEE = 0.0004;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
    const n = num(value);
    if (n == null) return null;
    return Number(n.toFixed(digits));
}

function pnlLinear(side, entry, exit, qty) {
    const s = String(side || "").toUpperCase();
    const e = num(entry);
    const x = num(exit);
    const q = Math.abs(num(qty) || 0);
    if (e == null || x == null || !(q > 0)) return null;
    const sign = s === "SHORT" ? -1 : 1;
    return round((x - e) * q * sign, 4);
}

function adversePct(side, mark, level) {
    const m = num(mark);
    const l = num(level);
    if (!(m > 0) || !(l > 0)) return null;
    const s = String(side || "").toUpperCase();
    if (s === "LONG") return round(((m - l) / m) * 100, 3);
    if (s === "SHORT") return round(((l - m) / m) * 100, 3);
    return null;
}

function favorablePct(side, mark, level) {
    const m = num(mark);
    const l = num(level);
    if (!(m > 0) || !(l > 0)) return null;
    const s = String(side || "").toUpperCase();
    if (s === "LONG") return round(((l - m) / m) * 100, 3);
    if (s === "SHORT") return round(((m - l) / m) * 100, 3);
    return null;
}

/**
 * Tính metrics vị thế từ row Terminal + market snapshot.
 */
function computePositionMetrics(row = {}, market = null) {
    const side = String(row.side || "").toUpperCase();
    const entry = num(row.entry);
    const mark = num(row.mark) ?? num(market?.tf15?.lastClose);
    const qty = Math.abs(num(row.size ?? row.exchangeQty ?? row.qty) || 0) || null;
    const leverage = num(row.leverage);
    const liq = num(row.liquidation);
    const sl = num(row.exchangeSl ?? row.sl);
    const tp = num(row.exchangeTp ?? row.tp);
    const unrealized = num(row.unrealized);

    const notional = qty != null && mark != null ? round(Math.abs(qty) * mark, 2) : null;
    const marginEst = notional != null && leverage > 0 ? round(notional / leverage, 2) : null;
    const feeRoundTrip = notional != null ? round(notional * TAKER_FEE * 2, 4) : null;

    const riskEntryToSl = sl != null ? pnlLinear(side, entry, sl, qty) : null;
    const riskMarkToSl = sl != null ? pnlLinear(side, mark, sl, qty) : null;
    const rewardMarkToTp = tp != null ? pnlLinear(side, mark, tp, qty) : null;
    const rewardEntryToTp = tp != null ? pnlLinear(side, entry, tp, qty) : null;

    let rrRemaining = null;
    if (riskMarkToSl != null && riskMarkToSl < 0 && rewardMarkToTp != null && rewardMarkToTp > 0) {
        rrRemaining = round(rewardMarkToTp / Math.abs(riskMarkToSl), 3);
    }

    const monitors = Array.isArray(row.monitors) ? row.monitors : [];
    const ownSum = monitors.reduce((s, m) => s + Math.abs(num(m.ownQty) || 0), 0);
    const exchangeQty = Math.abs(num(row.exchangeQty ?? row.size) || 0) || null;
    let ownership = "unknown";
    if (exchangeQty != null && exchangeQty > 0) {
        if (ownSum <= 0) ownership = "unassigned";
        else if (ownSum > exchangeQty * 1.01) ownership = "over";
        else if (ownSum < exchangeQty * 0.99) ownership = "under";
        else ownership = "matched";
    }

    const slCoversQty = sl != null; // Phase 1: có SL sàn (closePosition thường cover full); thiếu quantity coverage chi tiết nếu không có order book
    const slBeforeLiq = (() => {
        if (sl == null || liq == null || mark == null) return null;
        if (side === "LONG") return sl > liq;
        if (side === "SHORT") return sl < liq;
        return null;
    })();

    const atr = num(market?.atr14 ?? market?.tf15?.atr14);
    const entryAtrDist = atr != null && entry != null && mark != null
        ? round(Math.abs(mark - entry) / atr, 3)
        : null;

    const missingData = [];
    if (mark == null) missingData.push("mark");
    if (entry == null) missingData.push("entry");
    if (qty == null) missingData.push("qty");
    if (sl == null) missingData.push("exchange_sl");
    if (tp == null) missingData.push("exchange_tp");
    if (liq == null) missingData.push("liquidation");
    if (!market || market.error) missingData.push("market");
    if (leverage == null) missingData.push("leverage");

    return {
        account: row.account || null,
        symbol: row.symbol || null,
        side: side || null,
        book: row.book || null,
        entry,
        mark,
        qty,
        leverage,
        liquidation: liq,
        sl,
        tp,
        unrealized,
        notional,
        marginEst,
        feeRoundTripEst: feeRoundTrip,
        feeRateAssumed: TAKER_FEE,
        riskEntryToSl,
        riskMarkToSl,
        rewardMarkToTp,
        rewardEntryToTp,
        rrRemaining,
        slDistancePct: adversePct(side, mark, sl),
        tpDistancePct: favorablePct(side, mark, tp),
        liqDistancePct: adversePct(side, mark, liq),
        slCoversQty,
        slBeforeLiq,
        ownership,
        ownQtySum: ownSum || null,
        exchangeQty,
        monitors: monitors.map((m) => ({
            env: m.env || m.id || null,
            ownQty: num(m.ownQty),
            signal: m.signal || null,
            trailing: Boolean(m.trailing),
        })),
        entryAtrDist,
        marketAlignment: market?.alignment || null,
        multiTf: market?.multiTf || null,
        missingData,
        formulaVersion: "pos-metrics-v1",
    };
}

module.exports = {
    computePositionMetrics,
    pnlLinear,
    TAKER_FEE,
};
