const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const { extractJson, sanitizeSuggestion, inferPromptFilters } = require("../src/lib/account-statics-ai");

test("extractJson đọc object trong fence markdown", () => {
    const parsed = extractJson('Gợi ý:\n```json\n{"signal":"SIGNAL_A","minWin":60}\n```');
    assert.equal(parsed.signal, "SIGNAL_A");
    assert.equal(parsed.minWin, 60);
});

test("sanitizeSuggestion chỉ giữ signal đã biết và ngưỡng hợp lệ", () => {
    const out = sanitizeSuggestion({
        signal: "FAKE",
        signals: ["SIGNAL_A", "NOPE"],
        minWin: 72.4,
        minTrades: 12,
        gain: "1",
        side: "long",
        profit: "maybe",
        note: "Ưu tiên SIGNAL_A",
    }, ["SIGNAL_A", "SIGNAL_B"]);
    assert.equal(out.signal, "SIGNAL_A");
    assert.deepEqual(out.signals, ["SIGNAL_A"]);
    assert.equal(out.minWin, "72");
    assert.equal(out.minTrades, "12");
    assert.equal(out.gain, "1");
    assert.equal(out.side, "LONG");
    assert.equal(out.profit, "");
    assert.match(out.note, /SIGNAL_A/);
});

test("inferPromptFilters đọc tháng 10 và win rate từ câu hỏi", () => {
    const now = new Date("2026-10-14T10:00:00+07:00");
    const out = inferPromptFilters("Tìm các signal có tỉ lệ thắng trên 70% trong tháng 10 này", now);
    assert.equal(out.minWin, "70");
    assert.equal(out.rangeNote, "tháng 10/2026");
    assert.ok(out.from);
    assert.equal(new Date(out.from).getMonth(), 9);
    assert.equal(new Date(out.from).getFullYear(), 2026);
    assert.ok(out.to);
    assert.equal(out.clearSymbol, true);
});

test("inferPromptFilters đọc N ngày gần đây", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const out = inferPromptFilters("signal ổn trong 30 ngày", now);
    assert.match(out.rangeNote, /30 ngày/);
    const span = now.getTime() - new Date(out.from).getTime();
    assert.ok(span > 29 * 24 * 60 * 60 * 1000 && span < 31 * 24 * 60 * 60 * 1000);
});
