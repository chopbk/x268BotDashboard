const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractJson, normalizeBrief, compactRow, PROMPT_VERSION } = require("../src/lib/smart-money/ai-brief");

describe("smart-money ai-brief helpers", () => {
    it("extractJson đọc object trong fence", () => {
        const raw = '```json\n{"headline":"A","stance":"mixed","summary":"ok","bullets":["x"]}\n```';
        const parsed = extractJson(raw);
        assert.equal(parsed.headline, "A");
        assert.equal(parsed.stance, "mixed");
    });

    it("normalizeBrief clamp stance và bullets", () => {
        const brief = normalizeBrief(
            {
                headline: "Tiêu đề dài ".repeat(20),
                stance: "weird",
                summary: "Tóm tắt",
                bullets: ["a", "b", "c", "d", "e", "f", "g"],
                watch: ["BTCUSDT"],
                risks: ["r1"],
            },
            "fallback",
            { mode: "overview" }
        );
        assert.equal(brief.stance, "unclear");
        assert.equal(brief.bullets.length, 6);
        assert.equal(brief.watch[0], "BTCUSDT");
        assert.equal(brief.promptVersion, PROMPT_VERSION);
        assert.ok(brief.headline.length <= 160);
    });

    it("compactRow giữ null không ép 0", () => {
        const row = compactRow({
            symbol: "BTCUSDT",
            price: { mark: 100 },
            openInterest: { deltaPct: null },
            smartMoney: null,
            derived: { bias: "long", whaleBias: "short" },
            quality: { overall: "partial" },
        });
        assert.equal(row.oiDeltaPct, null);
        assert.equal(row.tradersLongQty, null);
        assert.equal(row.bias, "long");
        assert.equal(row.whaleBias, "short");
    });
});
