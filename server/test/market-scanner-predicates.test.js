const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateScanner, ALLOWED_PREDICATES } = require("../src/lib/market-scanner");

describe("market scanner predicates", () => {
    it("exports allowlist without eval", () => {
        assert.ok(ALLOWED_PREDICATES.has("price_change_pct"));
        assert.ok(!ALLOWED_PREDICATES.has("eval"));
    });

    it("missing metric skips row instead of false-positive hit", () => {
        const result = evaluateScanner(
            {
                predicates: [{ op: "price_change_pct", cmp: "gt", value: 1 }],
                combine: "and",
            },
            [{ symbol: "AAAUSDT" }, { symbol: "BBBUSDT", priceChangePct: 5 }],
            { candleClosed: true }
        );
        assert.equal(result.hits.length, 1);
        assert.equal(result.hits[0].symbol, "BBBUSDT");
        assert.ok(result.skipped.some((s) => s.symbol === "AAAUSDT" && s.reason === "missing_data"));
    });

    it("breakout waits for candle close", () => {
        const result = evaluateScanner(
            {
                predicates: [{ op: "breakout_state", cmp: "eq", value: "up" }],
                combine: "and",
            },
            [{ symbol: "ETHUSDT", breakoutState: "up" }],
            { candleClosed: false }
        );
        assert.equal(result.hits.length, 0);
        assert.ok(result.skipped.some((s) => s.reason === "candle_not_closed"));
    });
});
