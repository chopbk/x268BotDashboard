import test from "node:test";
import assert from "node:assert/strict";
import { protectionStatus, protectionCellText, needsAttention } from "./protection.js";
import { buildSummary, ownershipView } from "./summary.js";
import { matches, bookForApi, normalizeTab } from "./matches.js";
import { clampPanelWidth, rowMatchesSavedView, defaultPrefs } from "./prefs.js";
import { classifyMutationResult } from "./mutation.js";

test("protection: hiện giá SL/TP sàn", () => {
  const status = protectionStatus({ exchangeSl: 90, exchangeTp: 110, monitors: [] });
  assert.equal(status.sl.kind, "exchange");
  assert.equal(status.tp.kind, "exchange");
  const cell = protectionCellText(status);
  assert.match(cell.primary, /110/);
  assert.match(cell.primary, /90/);
});

test("protection: fallback monitor khi chưa có sổ lệnh", () => {
  const status = protectionStatus({
    monitors: [{ sl: "95", tp: "120", watching: true }],
  });
  assert.equal(status.sl.kind, "monitor");
  assert.equal(status.tp.kind, "monitor");
  assert.match(protectionCellText(status).primary, /95/);
});

test("protection: stale không che giá sàn đã có", () => {
  const status = protectionStatus({ exchangeSl: 82.6, exchangeTp: 99, monitors: [] }, { stale: true });
  assert.equal(status.sl.kind, "exchange");
  assert.match(protectionCellText(status).primary, /82\.6|82.6/);
});

test("protection: stale + không có mức → chưa xác minh", () => {
  const status = protectionStatus({ monitors: [] }, { stale: true });
  assert.equal(status.sl.kind, "unverified");
});

test("needsAttention: warnings / notpsl", () => {
  assert.equal(needsAttention({ warnings: ["qty-mismatch"], monitors: [] }), true);
  assert.equal(needsAttention({ warnings: [], notpsl: true, monitors: [] }), true);
  assert.equal(needsAttention({ warnings: [], monitors: [{ watching: true, sl: 1 }], exchangeSl: 1, exchangeTp: 2 }), false);
});

test("matches + book live adapter", () => {
  const live = { symbol: "BTCUSDT", side: "LONG", book: "live", monitors: [], warnings: [] };
  const paper = { ...live, book: "paper" };
  const params = new URLSearchParams();
  assert.equal(matches(live, params), true);
  assert.equal(matches(paper, params), false);
  params.set("book", "live");
  assert.equal(matches(live, params), true);
  assert.equal(bookForApi("live"), "");
  assert.equal(bookForApi("paper"), "paper");
});

test("normalizeTab respects permissions", () => {
  assert.equal(normalizeTab("fills", { canPositions: false, canOrders: true, canHistory: false }), "open-orders");
  assert.equal(normalizeTab("positions", { canPositions: false, canOrders: false, canHistory: true }), "position-history");
});

test("summary tách live/paper, không double-count", () => {
  const summary = buildSummary([
    { book: "live", unrealized: 10, exchangeQty: 1, mark: 100, warnings: [] },
    { book: "paper", unrealized: 5, exchangeQty: 2, mark: 50, warnings: ["stale"] },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.groups.live.unrealized, 10);
  assert.equal(summary.groups.paper.unrealized, 5);
});

test("ownership over-allocation không clamp", () => {
  const view = ownershipView({
    exchangeQty: 1,
    monitors: [{ ownQty: 0.8 }, { ownQty: 0.8 }],
  });
  assert.equal(view.allocation, "over");
  assert.ok(view.ownTotal > view.exchangeQty);
});

test("prefs clamp + saved view pnl", () => {
  assert.equal(clampPanelWidth(100), 360);
  assert.equal(clampPanelWidth(999), 560);
  assert.equal(defaultPrefs().version, 1);
  assert.equal(rowMatchesSavedView({ unrealized: 3 }, "profit"), true);
  assert.equal(rowMatchesSavedView({ unrealized: -1 }, "profit"), false);
});

test("classifyMutationResult: timeout → unknown, duplicate, accepted", () => {
  assert.equal(classifyMutationResult(null, { timedOut: true }).phase, "unknown");
  assert.equal(classifyMutationResult({ duplicate: true, command: { requestId: "a" } }).phase, "duplicate");
  assert.equal(classifyMutationResult({ command: { result: { orderId: "1", status: "NEW" } } }).phase, "accepted");
});
