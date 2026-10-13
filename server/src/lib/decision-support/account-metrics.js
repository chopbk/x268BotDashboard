const { computePositionMetrics } = require("./position-metrics");

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
    const n = num(value);
    if (n == null) return null;
    return Number(n.toFixed(digits));
}

/**
 * Gộp metrics tài khoản từ danh sách vị thế Terminal + wallet (Redis/ledger).
 * Không double-count sibling monitors; mỗi row = 1 vị thế sàn.
 */
function computeAccountMetrics({
    username = null,
    positions = [],
    wallet = null,
    riskProfile = null,
} = {}) {
    const rows = Array.isArray(positions) ? positions : [];
    const posMetrics = rows.map((row) => computePositionMetrics(row));

    const equity = num(wallet?.equity ?? wallet?.walletBalance);
    const available = num(wallet?.available ?? wallet?.availableBalance);
    const totalUnrealized = posMetrics.reduce((s, p) => s + (num(p.unrealized) || 0), 0);
    const grossNotional = posMetrics.reduce((s, p) => s + Math.abs(num(p.notional) || 0), 0);
    const exposurePct = equity != null && equity > 0
        ? round((grossNotional / equity) * 100, 2)
        : null;

    const missingSl = posMetrics.filter((p) => p.sl == null);
    const highLiqRisk = posMetrics.filter((p) => {
        const d = num(p.liqDistancePct);
        return d != null && d < 5;
    });

    // Tập trung theo symbol (không theo monitor)
    const bySymbol = new Map();
    for (const p of posMetrics) {
        const key = String(p.symbol || "").toUpperCase();
        if (!key) continue;
        const prev = bySymbol.get(key) || { symbol: key, notional: 0, count: 0 };
        prev.notional += Math.abs(num(p.notional) || 0);
        prev.count += 1;
        bySymbol.set(key, prev);
    }
    const concentration = [...bySymbol.values()]
        .map((x) => ({
            ...x,
            notional: round(x.notional, 2),
            pctOfEquity: equity != null && equity > 0
                ? round((x.notional / equity) * 100, 2)
                : null,
            pctOfGross: grossNotional > 0
                ? round((x.notional / grossNotional) * 100, 2)
                : null,
        }))
        .sort((a, b) => b.notional - a.notional);

    const topSymbol = concentration[0] || null;
    const maxConcPct = num(riskProfile?.maxSymbolConcentrationPct);

    const profileBreaches = [];
    if (riskProfile) {
        const maxDaily = riskProfile.maxLossDay;
        // Phase 1: chỉ flag concentration / missing profile fields; daily loss cần ledger ngày
        if (maxConcPct != null && topSymbol?.pctOfEquity != null && topSymbol.pctOfEquity > maxConcPct) {
            profileBreaches.push({
                code: "symbol_concentration",
                detail: `${topSymbol.symbol} ~${topSymbol.pctOfEquity}% equity > max ${maxConcPct}%`,
            });
        }
        const maxExp = riskProfile.maxExposureAccount;
        if (maxExp?.unit === "pct_equity" && exposurePct != null && num(maxExp.value) != null) {
            if (exposurePct > num(maxExp.value)) {
                profileBreaches.push({
                    code: "max_exposure",
                    detail: `Gross exposure ${exposurePct}% > max ${maxExp.value}%`,
                });
            }
        }
        if (maxDaily == null) {
            // not a breach — tracked in missingData
        }
    }

    const missingData = [];
    if (equity == null || !(equity > 0)) missingData.push("equity");
    if (available == null) missingData.push("available");
    if (!wallet) missingData.push("wallet");
    if (!riskProfile) missingData.push("risk_profile");
    if (missingSl.length) missingData.push("positions_without_sl");

    let riskLevelHint = "normal";
    if (missingData.includes("equity") || rows.length === 0) {
        riskLevelHint = "insufficient_data";
    } else if (missingSl.length >= 2 || highLiqRisk.length || profileBreaches.length) {
        riskLevelHint = "high";
    } else if (missingSl.length === 1 || (exposurePct != null && exposurePct > 300)) {
        riskLevelHint = "attention";
    }

    return {
        username: username || null,
        equity,
        available,
        totalUnrealized: round(totalUnrealized, 4),
        positionCount: rows.length,
        grossNotional: round(grossNotional, 2),
        exposurePct,
        missingSlCount: missingSl.length,
        missingSl: missingSl.map((p) => ({
            account: p.account,
            symbol: p.symbol,
            side: p.side,
        })),
        highLiqRisk: highLiqRisk.map((p) => ({
            account: p.account,
            symbol: p.symbol,
            side: p.side,
            liqDistancePct: p.liqDistancePct,
        })),
        concentration,
        topSymbol,
        profileBreaches,
        positions: posMetrics,
        riskLevelHint,
        missingData,
        formulaVersion: "acct-metrics-v1",
    };
}

module.exports = {
    computeAccountMetrics,
};
