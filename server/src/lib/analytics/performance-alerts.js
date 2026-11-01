/**
 * P4.4 — alerts phân tích. Không tắt signal/config, không mutate bot.
 */
function buildPerformanceAlerts(summary, { minSample = 20 } = {}) {
    const alerts = [];
    const m = summary?.metrics || {};
    const sample = summary?.sample || {};
    const valid = sample.valid || 0;

    if (valid >= minSample && m.profitFactor != null && m.profitFactor < 1) {
        alerts.push({
            id: "pf_below_1",
            severity: "warn",
            title: `Profit factor ${m.profitFactor} (<1) trên ${valid} lệnh`,
            action: "review",
            sideEffect: "none",
            note: "Không tự tắt signal/config",
        });
    }
    if (valid >= minSample && m.expectancy != null && m.expectancy < 0) {
        alerts.push({
            id: "negative_expectancy",
            severity: "warn",
            title: `Expectancy ${m.expectancy} âm trên ${valid} lệnh`,
            action: "review",
            sideEffect: "none",
        });
    }
    if (valid >= minSample && m.maxDrawdown != null && m.netPnL != null
        && m.netPnL > 0 && m.maxDrawdown > Math.abs(m.netPnL)) {
        alerts.push({
            id: "drawdown_exceeds_net",
            severity: "info",
            title: "Max DD lớn hơn net PnL kỳ",
            action: "review",
            sideEffect: "none",
        });
    }
    if (valid > 0 && valid < minSample) {
        alerts.push({
            id: "low_sample",
            severity: "info",
            title: `Mẫu ${valid} < minSample ${minSample} — không gắn nhãn edge`,
            action: "wait",
            sideEffect: "none",
        });
    }
    if (summary?.costCoverage?.quality === "incomplete") {
        alerts.push({
            id: "cost_incomplete",
            severity: "info",
            title: "Cost coverage incomplete — net PnL chỉ observed",
            action: "review",
            sideEffect: "none",
            missing: summary.costCoverage.missing,
        });
    }
    return {
        alerts,
        mutatesConfig: false,
        mutatesSignal: false,
        autoDisable: false,
    };
}

module.exports = { buildPerformanceAlerts };
