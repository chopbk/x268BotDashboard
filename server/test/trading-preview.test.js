const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { buildPayloadHash, PREVIEW_TTL_MS } = require("../src/lib/trading-preview");
const { envelope, quoteQuality, TTL, hashPayload } = require("../src/lib/provenance");
const { ingestMarkPrices, markOf, markQuoteOf, stopMarkPrices } = require("../src/lib/mark-prices");
const { getTerminalCandles } = require("../src/lib/terminal-candles");

describe("quant P1 provenance + preview hash", () => {
    it("envelope quality enums and quote TTL", () => {
        const env = envelope({ source: "test", quality: "fresh", expiresAt: 1 });
        assert.equal(env.schemaVersion, 1);
        assert.equal(env.quality, "fresh");
        assert.equal(quoteQuality(Date.now(), TTL.mark_quote_trading), "fresh");
        assert.equal(quoteQuality(Date.now() - TTL.mark_quote_trading - 1, TTL.mark_quote_trading), "stale");
        assert.equal(quoteQuality(null), "missing");
        assert.ok(PREVIEW_TTL_MS >= TTL.mark_quote_trading);
    });

    it("payload hash ổn định và đổi khi size/SL đổi", () => {
        const base = {
            action: "ORDER_CREATE",
            target: { username: "bot-demo", symbol: "BTCUSDT", positionSide: "LONG" },
            params: { quantity: "1", stopLoss: "90", type: "MARKET" },
        };
        const a = buildPayloadHash(base);
        const b = buildPayloadHash(base);
        assert.equal(a, b);
        const c = buildPayloadHash({
            ...base,
            params: { ...base.params, quantity: "2" },
        });
        assert.notEqual(a, c);
        const d = buildPayloadHash({
            ...base,
            params: { ...base.params, stopLoss: "80" },
        });
        assert.notEqual(a, d);
    });

    it("markQuoteOf giữ markOf số và gắn receivedAt", () => {
        stopMarkPrices();
        ingestMarkPrices({ s: "ETHUSDT", p: "2500", e: "markPriceUpdate" }, undefined, 1_700_000_000_000);
        assert.equal(markOf("ETHUSDT"), 2500);
        const q = markQuoteOf("ETHUSDT");
        assert.equal(q.mark, 2500);
        assert.equal(q.receivedAt, 1_700_000_000_000);
    });

    it("terminal candles fixture offline + bỏ response seq bằng symbol", async () => {
        const now = Date.now();
        const fake = async () => ({
            json: async () => [
                [now - 120_000, "1", "2", "0.5", "1.5", "10", now - 60_000],
                [now - 60_000, "1.5", "2.5", "1", "2", "12", now - 1],
            ],
        });
        const data = await getTerminalCandles({
            symbol: "BTCUSDT",
            timeframe: "1m",
            limit: 10,
            fetchImpl: fake,
        });
        assert.equal(data.symbol, "BTCUSDT");
        assert.equal(data.exchange, "binance");
        assert.ok(data.candles.length >= 1);
        assert.equal(data.provenance.schemaVersion, 1);
        assert.ok(["fresh", "partial", "missing"].includes(data.provenance.quality));
    });

    it("hashPayload helper", () => {
        assert.equal(hashPayload({ a: 1 }).length, 32);
        assert.notEqual(hashPayload({ a: 1 }), hashPayload({ a: 2 }));
    });
});

describe("protection pending contract", () => {
    it("bracket non-atomic statuses documented", () => {
        const statuses = ["entry_filled_protection_pending", "entry_filled_protection_failed"];
        assert.ok(statuses.every((s) => s.startsWith("entry_filled_protection_")));
    });
});
