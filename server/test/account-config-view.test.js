const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const { toSummary, toDetail, listConfigSummaries, listAssignedConfigGlance, updateConfigSummary, updateSelectedConfigs } = require("../src/lib/account-config-view");

const admin = { role: "admin", botUsernames: [] };
const viewer = {
    role: "viewer",
    customPermissions: ["config.view", "bots.view"],
    botUsernames: ["alpha"],
};

function configQuery(value) {
    return {
        select() {
            return this;
        },
        lean() {
            return Promise.resolve(value);
        },
    };
}

test("toSummary reports on, sides, signals and volume as cost times leverage", () => {
    const row = toSummary({
        env: "a1",
        signals: ["SIGNAL_A", "BULL"],
        trade_config: {
            ON: false,
            LONG: true,
            SHORT: false,
            FIX_COST_AMOUNT: 100,
            LONG_LEVERAGE: 20,
            MARGIN: { MODE: "fix", RATIO: 1 },
        },
    });
    assert.equal(row.on, false);
    assert.equal(row.long, true);
    assert.equal(row.short, false);
    assert.deepEqual(row.signals, ["SIGNAL_A", "BULL"]);
    assert.equal(row.mode, "FIX");
    assert.equal(row.volume, 2000);
    assert.equal(row.openType, "MARKET");
});

test("toDetail keeps the stoploss, take profit, open and copy groups", () => {
    const row = toDetail({
        env: "a1",
        signals: ["SIGNAL_A"],
        blacklist: ["BTCUSDT"],
        trade_config: {
            ON: true,
            FIX_COST_AMOUNT: 50,
            LONG_LEVERAGE: 10,
            OPEN: { TYPE: "limit", RISK: 4, FILTERS: { ON: true, LIST: ["FOMO"] } },
            TP: { TYPE: "FIX", PERCENT: [0.1, 0.2], CLOSE: 1, HOLD: false },
            SL: { TYPE: "atr", SL_CANDLE: "15m", SL_PERCENT: -0.3 },
            COPY: { ON: true, RATE: 0.1 },
            MARGIN: { MODE: "FIX" },
        },
    });
    assert.equal(row.openType, "LIMIT");
    assert.equal(row.slType, "ATR");
    assert.equal(row.slCandle, "15M");
    assert.deepEqual(row.tpPercent, [0.1, 0.2]);
    assert.equal(row.copy, true);
    assert.deepEqual(row.blacklist, ["BTCUSDT"]);
    assert.deepEqual(row.filters, ["FOMO"]);
});

test("listConfigSummaries rejects a bot outside scope before reading configs", async () => {
    const original = AccountConfig.find;
    let called = false;
    AccountConfig.find = () => {
        called = true;
        return configQuery([]);
    };
    try {
        await assert.rejects(() => listConfigSummaries(viewer, "beta"), (error) => {
            assert.equal(error.status, 403);
            return true;
        });
        assert.equal(called, false);
    } finally {
        AccountConfig.find = original;
    }
});

test("updateConfigSummary sets only the edited field and keeps the rest of trade_config", async () => {
    const originalUser = UserAccount.findOne;
    const originalFind = AccountConfig.findOne;
    const originalUpdate = AccountConfig.updateOne;
    let update;
    UserAccount.findOne = async () => ({ username: "alpha", accounts: ["a1"] });
    AccountConfig.findOne = () =>
        configQuery({
            env: "a1",
            signals: ["SIGNAL_A"],
            trade_config: {
                ON: true,
                LONG: true,
                SHORT: false,
                FIX_COST_AMOUNT: 100,
                LONG_LEVERAGE: 20,
                MARGIN: { MODE: "FIX" },
                SL: { TYPE: "MARKET" },
            },
        });
    AccountConfig.updateOne = async (filter, doc) => {
        update = { filter, doc };
        return { matchedCount: 1 };
    };
    try {
        await assert.rejects(() => updateConfigSummary(viewer, "alpha", "a1", { on: false }), (error) => {
            assert.equal(error.status, 403);
            return true;
        });
        assert.equal(update, undefined);

        await updateConfigSummary(admin, "alpha", "a1", { on: false });
        assert.deepEqual(update.filter, { env: "a1" });
        assert.deepEqual(update.doc.$set, { "trade_config.ON": false });
        assert.equal(Object.hasOwn(update.doc.$set, "trade_config"), false);
        assert.equal(Object.hasOwn(update.doc.$set, "trade_config.SL"), false);
    } finally {
        UserAccount.findOne = originalUser;
        AccountConfig.findOne = originalFind;
        AccountConfig.updateOne = originalUpdate;
    }
});

test("updateSelectedConfigs applies one patch to each selected config and skips the rest", async () => {
    const originalUser = UserAccount.findOne;
    const originalFind = AccountConfig.findOne;
    const originalUpdate = AccountConfig.updateOne;
    const updates = [];
    UserAccount.findOne = async () => ({ username: "alpha", accounts: ["a1", "a2"] });
    AccountConfig.findOne = (filter) => configQuery({
        env: filter.env,
        signals: ["ROSE"],
        trade_config: { ON: true, LONG: true, SHORT: false, FIX_COST_AMOUNT: 50, LONG_LEVERAGE: 10, MARGIN: { MODE: "FIX" } },
    });
    AccountConfig.updateOne = async (filter, doc) => {
        updates.push({ filter, doc });
        return { matchedCount: 1 };
    };
    try {
        const result = await updateSelectedConfigs(admin, "alpha", ["a1", "a2", "nope"], { on: false, cost: 80 });
        assert.deepEqual(result.updated.map((row) => row.env), ["a1", "a2"]);
        assert.equal(result.failed[0].env, "nope");
        assert.equal(updates.length, 2);
        assert.deepEqual(updates[0].doc.$set, { "trade_config.ON": false, "trade_config.FIX_COST_AMOUNT": 80 });
        assert.equal(Object.hasOwn(updates[0].doc.$set, "trade_config.LONG"), false);
        await assert.rejects(() => updateSelectedConfigs(admin, "alpha", ["a1"], {}), /Không có gì để sửa/);
    } finally {
        UserAccount.findOne = originalUser;
        AccountConfig.findOne = originalFind;
        AccountConfig.updateOne = originalUpdate;
    }
});

test("assigned config glance includes every bot an admin may view", async () => {
    const originalUsers = UserAccount.find;
    const originalConfigs = AccountConfig.find;
    UserAccount.find = () => ({
        select() { return this; },
        sort() { return this; },
        lean: async () => [
            { username: "HIEN", accounts: ["H"], ownerUserId: "other", visibility: "public" },
            { username: "secret", accounts: ["S"], ownerUserId: "other", visibility: "private" },
        ],
    });
    AccountConfig.find = () => ({
        select() { return this; },
        lean: async () => [],
    });
    try {
        const result = await listAssignedConfigGlance({ id: "admin", role: "admin", username: "root", botUsernames: [] });
        assert.deepEqual(result.users.map((row) => row.username), ["HIEN", "secret"]);
    } finally {
        UserAccount.find = originalUsers;
        AccountConfig.find = originalConfigs;
    }
});
