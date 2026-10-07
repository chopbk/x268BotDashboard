const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const SignalInfo = require("../src/models/signal-info");
const { listSignalHistory } = require("../src/lib/signal-history");

function query(value) {
    return {
        select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
        lean() { return Promise.resolve(value); },
        then(ok, fail) { return Promise.resolve(value).then(ok, fail); },
    };
}

test("account signal history uses only signals configured for that env", async () => {
    const originals = {
        user: UserAccount.findOne,
        config: AccountConfig.find,
        signal: SignalInfo.find,
        count: SignalInfo.countDocuments,
        aggregate: SignalInfo.aggregate,
    };
    let signalFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountConfig.find = () => query([{ env: "a1", signals: ["ROSE", "BULL"] }]);
    SignalInfo.find = (filter) => { signalFilter = filter; return query([{ _id: "1", signal: "ROSE", symbol: "BTCUSDT", side: "LONG", status: "CLOSE", openTime: new Date("2026-01-01") }]); };
    SignalInfo.countDocuments = async () => 1;
    SignalInfo.aggregate = async () => [{ _id: { signal: "ROSE", side: "LONG" }, count: 1 }];
    try {
        const result = await listSignalHistory({ id: "u1", role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", env: "a1" });
        assert.equal(result.total, 1);
        assert.equal(result.stats.long, 1);
        assert.deepEqual(result.envs, ["a1"]);
        assert.equal(signalFilter.signal.$in.includes("ROSE"), true);
        assert.equal(signalFilter.signal.$in.includes("BULL"), true);
    } finally {
        UserAccount.findOne = originals.user;
        AccountConfig.find = originals.config;
        SignalInfo.find = originals.signal;
        SignalInfo.countDocuments = originals.count;
        SignalInfo.aggregate = originals.aggregate;
    }
});

test("signal history rejects a config outside the selected user bot", async () => {
    const original = UserAccount.findOne;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    try {
        await assert.rejects(
            () => listSignalHistory({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", env: "other" }),
            (error) => error.status === 404
        );
    } finally {
        UserAccount.findOne = original;
    }
});
