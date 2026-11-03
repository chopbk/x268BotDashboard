const test = require("node:test");
const assert = require("node:assert/strict");
const { deltaBp, spread10y2yBp, commonObservationCurve, parseDisplayNumber } = require("../src/lib/market-economy/units");
const { parseFredCsv } = require("../src/lib/market-economy/providers/fred");
const { mergeMetricObservation } = require("../src/lib/market-economy/provenance");
const { buildContextBrief } = require("../src/lib/market-economy/brief");
const {
  resolveEventStatus,
  countdownInfo,
  normalizeTimeZone,
  calendarDateInZone,
  localDayUtcRange,
} = require("../src/lib/market-economy/calendar-status");
const { normalizeCalendarFeed } = require("../src/lib/market-economy/providers/calendar-ff");

test("deltaBp and spread use percent → bp", () => {
  assert.equal(deltaBp(4.1, 4.0), 10);
  assert.equal(deltaBp(3.9, 4.0), -10);
  assert.equal(deltaBp(null, 4), null);
  assert.equal(spread10y2yBp(4.0, 3.5), 50);
  assert.equal(spread10y2yBp(3.5, 4.0), -50);
});

test("commonObservationCurve requires shared date", () => {
  const by = {
    "us.yield.2y": { value: 4.0, observationDate: "2026-11-01" },
    "us.yield.10y": { value: 4.2, observationDate: "2026-11-02" },
  };
  const miss = commonObservationCurve(by, ["us.yield.2y", "us.yield.10y"]);
  assert.equal(miss.observationDate, null);

  by["us.yield.10y"].observationDate = "2026-11-01";
  const ok = commonObservationCurve(by, ["us.yield.2y", "us.yield.10y"]);
  assert.equal(ok.observationDate, "2026-11-01");
  assert.equal(ok.values["us.yield.10y"], 4.2);
});

test("parseDisplayNumber handles K/M/%", () => {
  assert.equal(parseDisplayNumber("7.15M"), 7.15e6);
  assert.equal(parseDisplayNumber("197K"), 197000);
  assert.equal(parseDisplayNumber("0.3%"), 0.3);
  assert.equal(parseDisplayNumber(""), null);
});

test("parseFredCsv skips dots", () => {
  const rows = parseFredCsv("observation_date,DGS10\n2026-11-01,4.10\n2026-11-02,.\n2026-11-03,4.05\n", "DGS10");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].value, 4.05);
});

test("fallback provenance giữ observedAt cũ", () => {
  const prev = {
    id: "crypto.fear_greed",
    value: 42,
    observedAt: "2026-11-01T00:00:00.000Z",
    lastSuccessfulFetchAt: "2026-11-01T00:00:00.000Z",
    quality: "fresh",
  };
  const merged = mergeMetricObservation(prev, { id: "crypto.fear_greed", failed: true, reason: "fng_fetch_failed" }, new Date("2026-11-03T12:00:00.000Z"));
  assert.equal(merged.value, 42);
  assert.equal(merged.observedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(merged.lastSuccessfulFetchAt, "2026-11-01T00:00:00.000Z");
  assert.equal(merged.lastAttemptAt, "2026-11-03T12:00:00.000Z");
  assert.equal(merged.quality, "stale");
});

test("event status due without actual; no released from series", () => {
  const past = new Date("2026-11-03T01:00:00.000Z");
  assert.equal(
    resolveEventStatus({
      scheduledAt: "2026-11-03T00:00:00.000Z",
      timePrecision: "datetime",
      hasTrustedActual: false,
      serverNow: past,
    }),
    "due"
  );
  assert.equal(
    resolveEventStatus({
      scheduledAt: "2026-11-03T00:00:00.000Z",
      hasTrustedActual: true,
      serverNow: past,
    }),
    "released"
  );
  const cd = countdownInfo("2026-11-03T00:30:00.000Z", new Date("2026-11-03T00:00:00.000Z"), "datetime");
  assert.equal(cd.badge, "Trong 60 phút");
  const noCd = countdownInfo("2026-11-03", new Date(), "date");
  assert.equal(noCd.countdownMs, null);
});

test("timezone normalize and local day range DST-safe enough", () => {
  assert.equal(normalizeTimeZone("Not/AZone"), "Asia/Ho_Chi_Minh");
  assert.equal(normalizeTimeZone("America/New_York"), "America/New_York");
  const day = localDayUtcRange("2026-11-03", "Asia/Ho_Chi_Minh");
  assert.ok(day);
  assert.equal(calendarDateInZone(day.from, "Asia/Ho_Chi_Minh"), "2026-11-03");
  const endMinus = new Date(new Date(day.to).getTime() - 1000);
  assert.equal(calendarDateInZone(endMinus, "Asia/Ho_Chi_Minh"), "2026-11-03");
});

test("calendar feed normalize is schedule-only", () => {
  const fixture = [
    {
      title: "CPI YoY",
      country: "USD",
      date: "2026-11-03T08:30:00-05:00",
      impact: "High",
      forecast: "2.5%",
      previous: "2.4%",
    },
  ];
  const out = normalizeCalendarFeed(fixture, "test_feed");
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].values.some((v) => v.field === "actual"), false);
  assert.ok(out.coverage.reasons.includes("actual_not_provided_by_feed"));
});

test("brief max 4 facts no causal claim", () => {
  const brief = buildContextBrief({
    metrics: {
      "us.yield.10y": { value: 4.1, deltaBp: 5, observationDate: "2026-11-02", quality: "fresh" },
      "us.yield.spread_10y_2y": { value: -12, observationDate: "2026-11-02", quality: "fresh" },
      "us.vix.close": { value: 18, observationDate: "2026-11-02", quality: "fresh" },
    },
    cryptoRefs: {
      btc: { price: 100000 },
      btcDominance: { value: 55, observedAt: "2026-11-03T00:00:00.000Z", quality: "fresh", id: "crypto.btc_dominance" },
      fearGreed: { value: 40, displayValue: "Fear", observedAt: "2026-11-02T00:00:00.000Z", quality: "fresh", id: "crypto.fear_greed" },
    },
    nextEvent: {
      eventId: "econ_abc",
      title: "CPI",
      scheduledAt: "2026-11-03T12:00:00.000Z",
      currency: "USD",
      status: "scheduled",
    },
  });
  assert.equal(brief.title, "Bối cảnh kinh tế");
  assert.ok(brief.facts.length <= 4);
  assert.ok(!brief.facts.some((f) => /vì CPI|nhân quả/i.test(f.text)));
});
