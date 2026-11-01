const {
    METRIC_DEFINITIONS_VERSION,
    ACCOUNTING_BASES,
    publicCatalog,
} = require("./metric-definitions");

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
    const n = num(value);
    if (n == null) return null;
    return Number(n.toFixed(digits));
}

function profitOk(value) {
    return value != null && value !== "" && Number.isFinite(Number(value));
}

function ymd(value) {
    const d = new Date(value || 0);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

/**
 * Net PnL per trade với cost coverage — không trừ phí lần 2 nếu đã net.
 */
function resolveTradeNet(row, { accountingBasis = ACCOUNTING_BASES.OBSERVED_STATIC_PROFIT } = {}) {
    const missing = [];
    const gross = num(row.grossPnL ?? row.realizedGross);
    let profit = num(row.profit);
    const fees = num(row.fees ?? row.commission);
    const funding = num(row.funding ?? row.fundingFee);
    const pnlIncludesFees = row.pnlIncludesFees === true || row.stats?.pnlIncludesFees === true;

    if (accountingBasis === ACCOUNTING_BASES.WALLET_TRADING_NET) {
        if (profit == null && gross == null) {
            return { net: null, quality: "missing", missing: ["profit"], basis: accountingBasis };
        }
        let net = profit != null ? profit : gross;
        if (!pnlIncludesFees) {
            if (fees == null) missing.push("fees");
            else net = (net || 0) - fees;
            if (funding == null) missing.push("funding");
            else net = (net || 0) + funding;
        }
        return {
            net: round(net, 6),
            quality: missing.length ? "partial" : "fresh",
            missing,
            basis: accountingBasis,
        };
    }

    // observed_static_profit (canonical Reports)
    if (!profitOk(row.profit)) {
        return { net: null, quality: "missing", missing: ["profit"], basis: ACCOUNTING_BASES.OBSERVED_STATIC_PROFIT };
    }
    if (!pnlIncludesFees && (fees != null || funding != null)) {
        // Đã có fee/funding riêng nhưng profit field là observed — không trừ lại
        missing.push("fee_basis_ambiguous");
    }
    if (!pnlIncludesFees && fees == null) missing.push("fees");
    if (!pnlIncludesFees && funding == null) missing.push("funding");
    return {
        net: round(profit, 6),
        quality: missing.length ? "incomplete" : "fresh",
        missing,
        basis: ACCOUNTING_BASES.OBSERVED_STATIC_PROFIT,
        note: pnlIncludesFees ? "profit_already_net" : "observed_profit_cost_coverage_unknown",
    };
}

function rMultiple(net, initialRisk) {
    const risk = num(initialRisk);
    if (!(risk > 0) || net == null) {
        return { r: null, quality: risk == null ? "missing" : "invalid_risk" };
    }
    return { r: round(net / risk, 6), quality: "fresh" };
}

function stdev(values) {
    if (!values.length) return null;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const varSum = values.reduce((s, v) => s + (v - mean) ** 2, 0);
    return Math.sqrt(varSum / values.length);
}

function downsideDev(values, mar = 0) {
    if (!values.length) return null;
    const downs = values.map((v) => Math.min(0, v - mar));
    const varSum = downs.reduce((s, v) => s + v * v, 0);
    return Math.sqrt(varSum / values.length);
}

/**
 * Sharpe/Sortino trên return series cùng cadence (ngày). Không dùng raw trade PnL size lệch.
 * equityPoints: [{ t, equity }] sorted; returns = Δequity/prevEquity.
 */
function riskAdjustedReturns(equityPoints, {
    riskFreePerPeriod = 0,
    periodsPerYear = 365,
    minPeriods = 5,
} = {}) {
    const pts = (equityPoints || []).filter((p) => num(p.equity) != null);
    if (pts.length < 2) {
        return {
            sharpe: null,
            sortino: null,
            sample: pts.length,
            quality: "missing",
            reason: "insufficient_equity_points",
            periodsPerYear,
            riskFreePerPeriod,
        };
    }
    const returns = [];
    for (let i = 1; i < pts.length; i += 1) {
        const prev = num(pts[i - 1].equity);
        const cur = num(pts[i].equity);
        // Equity <= 0 làm return series không hợp lệ cho Sharpe
        if (!(prev > 0) || cur == null || !(cur > 0)) {
            return {
                sharpe: null,
                sortino: null,
                sample: 0,
                quality: "incomplete",
                reason: "equity_lte_0_or_gap",
                periodsPerYear,
                riskFreePerPeriod,
            };
        }
        returns.push((cur - prev) / prev);
    }
    if (returns.length < minPeriods) {
        return {
            sharpe: null,
            sortino: null,
            sample: returns.length,
            quality: "low_sample",
            reason: "below_min_periods",
            periodsPerYear,
            riskFreePerPeriod,
        };
    }
    const excess = returns.map((r) => r - riskFreePerPeriod);
    const mean = excess.reduce((s, v) => s + v, 0) / excess.length;
    const sd = stdev(excess);
    const dd = downsideDev(excess, 0);
    const ann = Math.sqrt(periodsPerYear);
    const sharpe = sd > 0 ? round((mean / sd) * ann, 4) : null;
    const sortino = dd > 0 ? round((mean / dd) * ann, 4) : null;
    return {
        sharpe,
        sortino,
        sample: returns.length,
        quality: "fresh",
        meanReturn: round(mean, 8),
        periodsPerYear,
        riskFreePerPeriod,
        annualization: `sqrt(${periodsPerYear})`,
    };
}

/**
 * MAE/MFE side-aware. fidelity incomplete khi thiếu inventory path / DCA.
 */
function excursionMetrics(row) {
    const side = String(row.side || row.positionSide || "LONG").toUpperCase();
    const entry = num(row.entryPrice ?? row.entry);
    const maePrice = num(row.maePrice ?? row.minPrice);
    const mfePrice = num(row.mfePrice ?? row.maxPrice);
    const maeRoe = num(row.mae ?? row.minRoe);
    const mfeRoe = num(row.mfe ?? row.maxRoe);
    const dcaCount = Number(row.dcaCount || row.addCount || 0);
    const partialExit = Boolean(row.partialExit || row.tp1Hit);
    const missing = [];
    if (dcaCount > 0 || partialExit) missing.push("dca_or_partial_inventory");
    if (entry == null && maeRoe == null && mfeRoe == null) {
        return { mae: null, mfe: null, fidelity: "missing", missing: ["price_path"] };
    }
    let mae = maeRoe;
    let mfe = mfeRoe;
    if (entry != null && maePrice != null) {
        mae = side === "SHORT" ? round((maePrice - entry) / entry, 6) : round((entry - maePrice) / entry, 6);
    }
    if (entry != null && mfePrice != null) {
        mfe = side === "SHORT" ? round((entry - mfePrice) / entry, 6) : round((mfePrice - entry) / entry, 6);
    }
    return {
        mae,
        mfe,
        fidelity: missing.length ? "incomplete" : (mae == null && mfe == null ? "missing" : "estimate"),
        missing,
        method: entry != null && (maePrice != null || mfePrice != null) ? "price_path" : "roe_proxy",
    };
}

/**
 * Aggregate strategy metrics từ danh sách trade (account_statics shape).
 */
function computeStrategyMetrics(trades = [], options = {}) {
    const accountingBasis = options.accountingBasis || ACCOUNTING_BASES.OBSERVED_STATIC_PROFIT;
    const minSample = Number(options.minSample) > 0 ? Number(options.minSample) : 20;
    const cashflows = options.cashflows || null; // [{ t, amount }] external

    let wins = 0;
    let losses = 0;
    let flats = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let netSum = 0;
    let valid = 0;
    let rSum = 0;
    let rCount = 0;
    let rUnknown = 0;
    const costMissing = new Set();
    const excursions = [];
    const timed = [];

    for (const row of trades) {
        const resolved = resolveTradeNet(row, { accountingBasis });
        resolved.missing.forEach((m) => costMissing.add(m));
        if (resolved.net == null) continue;
        valid += 1;
        const net = resolved.net;
        netSum += net;
        if (net > 0) { wins += 1; grossWin += net; }
        else if (net < 0) { losses += 1; grossLoss += net; }
        else flats += 1;

        const rm = rMultiple(net, row.initialPlannedRisk ?? row.initialRisk ?? row.riskUsd);
        if (rm.r == null) rUnknown += 1;
        else { rSum += rm.r; rCount += 1; }

        excursions.push(excursionMetrics(row));
        const t = new Date(row.closeTime || row.openTime || 0).getTime();
        timed.push({ t: Number.isFinite(t) ? t : 0, net, day: ymd(row.closeTime || row.openTime) });
    }

    timed.sort((a, b) => a.t - b.t);

    // Equity from 0 + optional cashflow adjust
    let equity = num(options.startingEquity) || 0;
    let peak = equity;
    let maxDrawdown = 0;
    const byDay = new Map();
    const equityPoints = [];
    if (options.startingEquity != null) {
        equityPoints.push({ t: "start", equity: round(equity, 6) });
    }

    const flowByDay = new Map();
    for (const f of cashflows || []) {
        const day = ymd(f.t || f.day);
        if (!day) continue;
        flowByDay.set(day, (flowByDay.get(day) || 0) + (num(f.amount) || 0));
    }

    for (const row of timed) {
        const flow = row.day ? (flowByDay.get(row.day) || 0) : 0;
        if (flow) {
            equity += flow;
            flowByDay.delete(row.day);
        }
        equity = round(equity + row.net, 6) || 0;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, round(peak - equity, 6) || 0);
        if (row.day) {
            byDay.set(row.day, { day: row.day, equity, cumulativePnL: round(netSum, 6) });
        }
        equityPoints.push({ t: row.day || String(row.t), equity });
    }

    const rated = wins + losses + flats;
    let profitFactor = null;
    let profitFactorLabel = null;
    if (wins > 0 && losses > 0) profitFactor = round(grossWin / Math.abs(grossLoss), 4);
    else if (wins > 0 && losses === 0 && valid > 0) profitFactorLabel = "Không có lệnh lỗ";

    const riskAdj = riskAdjustedReturns(equityPoints, {
        riskFreePerPeriod: options.riskFreePerPeriod || 0,
        periodsPerYear: options.periodsPerYear || 365,
    });

    const maeVals = excursions.map((e) => e.mae).filter((v) => v != null);
    const mfeVals = excursions.map((e) => e.mfe).filter((v) => v != null);
    const incompleteExc = excursions.filter((e) => e.fidelity === "incomplete").length;

    const edgeClaimAllowed = valid >= minSample && profitFactor != null;
    const quality = valid === 0
        ? "missing"
        : (costMissing.size || incompleteExc ? "partial" : "fresh");

    return {
        definitionsVersion: METRIC_DEFINITIONS_VERSION,
        accountingBasis,
        sample: {
            trades: trades.length,
            valid,
            wins,
            losses,
            flats,
            minSample,
            edgeClaimAllowed,
            note: edgeClaimAllowed
                ? null
                : "low_sample_or_undefined_pf_not_edge_evidence",
        },
        metrics: {
            netPnL: valid ? round(netSum, 4) : null,
            winRate: rated ? round((wins / rated) * 100, 2) : null,
            expectancy: valid ? round(netSum / valid, 4) : null,
            expectancyR: rCount ? round(rSum / rCount, 4) : null,
            rCoverage: { known: rCount, unknown: rUnknown },
            profitFactor,
            profitFactorLabel,
            maxDrawdown: valid || options.startingEquity != null ? round(maxDrawdown, 4) : null,
            maxDrawdownCashflowAdjusted: Boolean(cashflows?.length),
            sharpe: riskAdj.sharpe,
            sortino: riskAdj.sortino,
            riskAdjusted: riskAdj,
            maeAvg: maeVals.length ? round(maeVals.reduce((s, v) => s + v, 0) / maeVals.length, 6) : null,
            mfeAvg: mfeVals.length ? round(mfeVals.reduce((s, v) => s + v, 0) / mfeVals.length, 6) : null,
            excursionFidelity: {
                incompleteCount: incompleteExc,
                total: excursions.length,
                note: incompleteExc
                    ? "DCA/partial path — MAE/MFE không khẳng định cả position"
                    : null,
            },
        },
        costCoverage: {
            quality: costMissing.size ? "incomplete" : "fresh",
            missing: [...costMissing],
        },
        series: [...byDay.values()],
        quality,
        catalog: options.includeCatalog ? publicCatalog() : undefined,
    };
}

function groupBy(trades, keyFn) {
    const map = new Map();
    for (const row of trades || []) {
        const key = keyFn(row) || "UNKNOWN";
        const list = map.get(key) || [];
        list.push(row);
        map.set(key, list);
    }
    return map;
}

function computeBreakdown(trades, options = {}) {
    const dims = {
        signal: (r) => String(r.typeSignal || r.signal || "UNKNOWN"),
        env: (r) => String(r.env || "UNKNOWN"),
        symbol: (r) => String(r.symbol || "UNKNOWN").toUpperCase(),
    };
    const out = {};
    for (const [name, fn] of Object.entries(dims)) {
        const groups = [];
        for (const [key, rows] of groupBy(trades, fn)) {
            const m = computeStrategyMetrics(rows, { ...options, includeCatalog: false });
            groups.push({
                key,
                valid: m.sample.valid,
                netPnL: m.metrics.netPnL,
                winRate: m.metrics.winRate,
                profitFactor: m.metrics.profitFactor,
                expectancy: m.metrics.expectancy,
                edgeClaimAllowed: m.sample.edgeClaimAllowed,
            });
        }
        groups.sort((a, b) => (b.valid || 0) - (a.valid || 0));
        out[name] = groups.slice(0, 50);
    }
    return out;
}

module.exports = {
    resolveTradeNet,
    rMultiple,
    riskAdjustedReturns,
    excursionMetrics,
    computeStrategyMetrics,
    computeBreakdown,
    ACCOUNTING_BASES,
};
