const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const { extractJson, sanitizeSuggestion } = require("../src/lib/account-statics-ai");

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
