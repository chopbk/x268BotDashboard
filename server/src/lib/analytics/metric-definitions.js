/**
 * Quant Terminal P4 — metric definitions versioned (một nguồn cho reports/analytics).
 * Không tạo định nghĩa PnL song song với account-statics/ledger.
 */
const METRIC_DEFINITIONS_VERSION = "quant.metrics.v1";

const ACCOUNTING_BASES = Object.freeze({
    OBSERVED_STATIC_PROFIT: "observed_static_profit",
    WALLET_TRADING_NET: "wallet_trading_net",
    UNKNOWN: "unknown",
});

const DEFINITIONS = Object.freeze({
    netPnL: {
        id: "netPnL",
        unit: "quote",
        formula: "gross_realized + funding_cashflow - fees; nếu profit đã net thì không trừ phí lần hai",
        requires: ["fills_or_static_profit"],
        incompleteWhen: ["missing_fees", "missing_funding"],
    },
    winRate: {
        id: "winRate",
        unit: "percent",
        formula: "wins / (wins + losses + flats) trên profit hợp lệ; không dùng status WIN",
        requires: ["profit_numeric"],
    },
    expectancy: {
        id: "expectancy",
        unit: "quote_per_trade",
        formula: "mean(netPnL per trade); ghi rõ đơn vị — mean(R) là expectancyR riêng",
        requires: ["profit_numeric"],
    },
    profitFactor: {
        id: "profitFactor",
        unit: "ratio",
        formula: "sum(net winners) / abs(sum(net losers)); không có losers → undefined + sampleCount",
        requires: ["profit_numeric"],
    },
    rMultiple: {
        id: "rMultiple",
        unit: "R",
        formula: "netPnL / initialPlannedRisk; mẫu số chốt lúc entry, không trailing",
        requires: ["initial_planned_risk"],
        incompleteWhen: ["missing_initial_risk"],
    },
    maxDrawdown: {
        id: "maxDrawdown",
        unit: "quote",
        formula: "peak-to-trough trên equity cadence đã chọn; cashflow-adjusted khi có deposits/withdrawals",
        requires: ["equity_series"],
    },
    sharpe: {
        id: "sharpe",
        unit: "ratio",
        formula: "mean(excessReturn) / stdev(returns) * sqrt(periodsPerYear); không tính từ PnL size lệch",
        requires: ["return_series_same_cadence"],
    },
    sortino: {
        id: "sortino",
        unit: "ratio",
        formula: "mean(excessReturn) / downsideDev(returns) * sqrt(periodsPerYear)",
        requires: ["return_series_same_cadence"],
    },
    mae: {
        id: "mae",
        unit: "price_or_R",
        formula: "side-aware adverse excursion trên đường giá hold; candles = estimate",
        incompleteWhen: ["partial_inventory", "dca_incomplete_path"],
    },
    mfe: {
        id: "mfe",
        unit: "price_or_R",
        formula: "side-aware favorable excursion; cùng điều kiện fidelity MAE",
        incompleteWhen: ["partial_inventory", "dca_incomplete_path"],
    },
});

function publicCatalog() {
    return {
        version: METRIC_DEFINITIONS_VERSION,
        accountingBases: ACCOUNTING_BASES,
        definitions: DEFINITIONS,
        rankingDefaults: {
            minSample: 20,
            requireCostCoverage: true,
            sortWinRateAloneIsNotEdge: true,
        },
        notes: [
            "Reuse account_statics.profit basis unless wallet_trading_net requested",
            "provider-scorecard win-by-status is NOT the Q5 default",
        ],
    };
}

module.exports = {
    METRIC_DEFINITIONS_VERSION,
    ACCOUNTING_BASES,
    DEFINITIONS,
    publicCatalog,
};
