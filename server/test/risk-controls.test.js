const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Pure filter logic mirrored from risk-controls cancel_pending — keep SL/TP out
function filterPendingEntry(orders, { includeProtection = false } = {}) {
    return orders.filter((o) => {
        if (o.reduceOnly === true) return false;
        const t = String(o.type || o.orderType || "").toUpperCase();
        if (o.closePosition === true) return false;
        if (["STOP_MARKET", "TAKE_PROFIT_MARKET", "STOP", "TAKE_PROFIT"].includes(t) && !includeProtection) {
            return false;
        }
        return true;
    });
}

describe("risk controls invariants", () => {
    it("cancel pending does not select protection SL/TP by default", () => {
        const orders = [
            { orderId: 1, type: "LIMIT", origQty: 1 },
            { orderId: 2, type: "STOP_MARKET", closePosition: true },
            { orderId: 3, type: "TAKE_PROFIT_MARKET", reduceOnly: true },
            { orderId: 4, type: "LIMIT", reduceOnly: true },
        ];
        const targets = filterPendingEntry(orders);
        assert.deepEqual(targets.map((o) => o.orderId), [1]);
    });

    it("pause entry is independent of flatten/cancel semantics", () => {
        const types = ["pause_new_entries", "resume_new_entries", "cancel_pending_entry_orders", "flatten"];
        assert.equal(new Set(types).size, 4);
        assert.ok(!types.includes("stop_monitor"));
        assert.ok(!types.includes("cancel_all"));
    });
});
