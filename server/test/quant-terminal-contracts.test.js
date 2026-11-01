const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const CONTRACT_DIR = path.join(__dirname, "../../docs/contracts/quant-terminal");
const FIXTURE_DIR = path.join(CONTRACT_DIR, "fixtures");

function readJson(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
}

describe("quant-terminal P0 contracts", () => {
    const contractFiles = [
        "identity.v1.json",
        "provenance.v1.json",
        "reservation.v1.json",
        "capability.v1.json",
        "compatibility.v1.json",
        "entry-surfaces.v1.json",
    ];

    for (const name of contractFiles) {
        it(`loads ${name}`, () => {
            const doc = readJson(path.join(CONTRACT_DIR, name));
            assert.equal(typeof doc.contractId, "string");
            assert.equal(doc.schemaVersion, 1);
            assert.ok(doc.status === "locked_p0" || doc.auditedAt);
        });
    }

    it("identity forbids messId as tradeInstanceId", () => {
        const identity = readJson(path.join(CONTRACT_DIR, "identity.v1.json"));
        assert.deepEqual(identity.fields.messId.mustNotReplace, [
            "tradeInstanceId",
            "signalEventId",
            "requestId",
        ]);
        assert.equal(identity.fields.tradeInstanceId.existing, null);
    });

    it("reservation keeps reduce paths unblocked", () => {
        const reservation = readJson(path.join(CONTRACT_DIR, "reservation.v1.json"));
        assert.equal(reservation.defaultPolicyMode, "observe");
        assert.ok(reservation.mustRemainUnblockedWhenEntryBlocked.includes("POSITION_CLOSE"));
        assert.equal(reservation.unknownOrderRule.onLeaseExpire, "do_not_auto_release_if_exchange_state_unknown");
        assert.equal(reservation.accountingBasis.accountExposure, "exchange_book_once");
        assert.equal(reservation.accountingBasis.configAttribution, "own_qty_only");
    });

    it("entry surfaces separate trading from config MQTT bridge", () => {
        const surfaces = readJson(path.join(CONTRACT_DIR, "entry-surfaces.v1.json"));
        assert.equal(surfaces.webTradingPath.notViaMqttConfigBridge, true);
        assert.ok(surfaces.botExposureIncreasers.some((s) => s.id === "manual_open" && s.localGate.includes("bypasses")));
        assert.ok(surfaces.protectReducePaths.length >= 4);
    });

    it("fixtures stay offline and well-formed", () => {
        const timeline = readJson(path.join(FIXTURE_DIR, "timeline-events.fixture.json"));
        const risk = readJson(path.join(FIXTURE_DIR, "risk-reservation.fixture.json"));
        const engines = readJson(path.join(FIXTURE_DIR, "backtest-engines.fixture.json"));
        assert.ok(timeline.cases.some((c) => c.name === "two_rounds_same_symbol_side"));
        assert.ok(risk.cases.some((c) => c.name === "lease_expire_unknown_order"));
        assert.ok(engines.engines.every((e) => e.parityReady === false));
    });

    it("compatibility treats legacy writers as coverage gaps", () => {
        const compat = readJson(path.join(CONTRACT_DIR, "compatibility.v1.json"));
        assert.ok(compat.matrix.some((row) => row.p0Status === "missing_hook"));
        assert.ok(compat.rollback.includes("never_drop_data_or_toggle_PAPER_INVERT_as_migration"));
    });
});
