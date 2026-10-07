const test = require("node:test");
const assert = require("node:assert/strict");
const SummarySnapshot = require("../src/models/summary-snapshot");
const { INDEXES } = require("../src/lib/summary-indexes");
const { FORMULA_VERSION, snapshotKey, ttlFor, acquireLease, getSummarySnapshot } = require("../src/lib/summary-snapshots");

function lean(value) { return { lean: async () => value }; }

test("summary source indexes cover requested production filters", () => {
    assert.deepEqual(INDEXES.slice(0, 4).map(([collection, keys]) => [collection, keys]), [
        ["account_statics", { env: 1, isPaper: 1, openTime: 1 }],
        ["futures_profits", { env: 1, day: 1 }],
        ["monitor_positions", { env: 1, closed: 1 }],
        ["signal_infos", { openTime: 1 }],
    ]);
});

test("all-time snapshots stay fresh longer than rolling snapshots", () => {
    assert.ok(ttlFor("all") > ttlFor("30d"));
    assert.equal(snapshotKey("3d"), `${FORMULA_VERSION}:3d`);
});

test("lease acquisition is atomic and records the owner", async (t) => {
    let filter;
    let update;
    t.mock.method(SummarySnapshot, "findOneAndUpdate", (nextFilter, nextUpdate) => {
        filter = nextFilter;
        update = nextUpdate;
        return lean({ _id: snapshotKey("7d"), leaseOwner: "worker-a" });
    });
    const now = new Date("2026-10-07T12:00:00.000Z");
    const lease = await acquireLease("7d", now, "worker-a");
    assert.equal(filter._id, snapshotKey("7d"));
    assert.equal(update.$set.status, "refreshing");
    assert.equal(update.$set.leaseOwner, "worker-a");
    assert.ok(update.$set.leaseUntil > now);
    assert.equal(lease.leaseOwner, "worker-a");
});

test("fresh request reads materialized snapshot without aggregating", async (t) => {
    const generatedAt = new Date("2026-10-07T11:59:00.000Z");
    const staleAt = new Date("2026-10-07T12:01:00.000Z");
    t.mock.method(SummarySnapshot, "findById", () => lean({
        _id: snapshotKey("3d"), range: "3d", formulaVersion: FORMULA_VERSION,
        status: "ready", generatedAt, staleAt, payload: { tradeCount: 12 },
    }));
    const result = await getSummarySnapshot("3d", new Date("2026-10-07T12:00:00.000Z"));
    assert.equal(result.tradeCount, 12);
    assert.equal(result.cached, true);
    assert.deepEqual(result.snapshot, { range: "3d", formulaVersion: FORMULA_VERSION, status: "ready", generatedAt, staleAt });
});
