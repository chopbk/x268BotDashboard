const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const TelegramClient = require("../src/models/telegram-client");
const RuntimeLog = require("../src/models/runtime-log");
const { mergeSignals, listSignalSetup, applySignals } = require("../src/lib/signal-setup");

const admin = { id: "admin", role: "admin", botUsernames: [] };
const operator = { id: "op", role: "operator", botUsernames: ["V"] };

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        lean() { return Promise.resolve(value); },
    };
}

test("mergeSignals adds without dropping the current list and removes only the named signal", () => {
    assert.deepEqual(mergeSignals(["ROSE", "TAM"], ["BULL"], "add"), ["ROSE", "TAM", "BULL"]);
    assert.deepEqual(mergeSignals(["ROSE", "TAM"], ["ROSE"], "add"), ["ROSE", "TAM"]);
    assert.deepEqual(mergeSignals(["rose", "TAM"], ["ROSE"], "remove"), ["TAM"]);
});

test("listSignalSetup lists channels without secrets and scopes parse errors to visible signals", async () => {
    const originals = {
        users: UserAccount.find,
        user: UserAccount.findOne,
        configs: AccountConfig.find,
        channels: TelegramClient.find,
        logs: RuntimeLog.find,
        aggregate: RuntimeLog.aggregate,
    };
    let parseMatch;
    UserAccount.findOne = async () => ({ username: "V", accounts: ["V1"], ownerUserId: "other", visibility: "public", active: true });
    UserAccount.find = () => query([
        { username: "V", accounts: ["V1"], ownerUserId: "other", visibility: "public", active: true },
        { username: "HIDDEN", accounts: ["H1"], ownerUserId: "other", visibility: "private", active: true },
    ]);
    const configs = [
        { env: "V1", signals: ["ROSE"], trade_config: { ON: true, AUTO_REMOVE: true } },
        { env: "H1", signals: ["SECRET"], trade_config: { ON: true } },
    ];
    AccountConfig.find = (filter) => query(configs.filter((doc) => !filter?.env?.$in || filter.env.$in.includes(doc.env)));
    TelegramClient.find = () => query([
        { stringSession: "secret-session", apiHash: "secret-hash", channels: [{ name: "Rose", ocr: true }, { name: "Bull" }] },
    ]);
    const removed = [
        { at: new Date("2026-10-01T00:00:00Z"), env: "V1", signal: "ROSE", message: "Remove signal ROSE" },
        { at: new Date("2026-10-01T00:00:00Z"), env: "H1", signal: "SECRET", message: "Remove signal SECRET" },
    ];
    RuntimeLog.find = (match) => query(removed.filter((row) => !match?.env?.$in || match.env.$in.includes(row.env)));
    RuntimeLog.aggregate = async (pipeline) => {
        parseMatch = pipeline[0].$match;
        return [{ _id: "ROSE", count: 4, lastAt: new Date("2026-10-02T00:00:00Z"), sample: "Parse thiếu side hoặc symbol ROSE" }];
    };
    try {
        const view = await listSignalSetup(operator, { username: "V" });
        assert.deepEqual(view.bots.map((row) => row.username), ["V"]);
        assert.deepEqual(view.channels.map((row) => row.name), ["ROSE"]);
        assert.equal(JSON.stringify(view).includes("secret-session"), false);
        assert.equal(JSON.stringify(view).includes("SECRET"), false);
        assert.equal(view.accounts[0].autoRemove, true);
        assert.equal(view.editable, true);
        assert.deepEqual(parseMatch.signal.$in, ["ROSE"]);
        assert.deepEqual(view.removed.map((row) => row.env), ["V1"]);
    } finally {
        UserAccount.find = originals.users;
        UserAccount.findOne = originals.user;
        AccountConfig.find = originals.configs;
        TelegramClient.find = originals.channels;
        RuntimeLog.find = originals.logs;
        RuntimeLog.aggregate = originals.aggregate;
    }
});

test("catalog counts signals only on owned or assigned accounts", async () => {
    const originals = { users: UserAccount.find, configs: AccountConfig.find, channels: TelegramClient.find, logs: RuntimeLog.find, aggregate: RuntimeLog.aggregate };
    UserAccount.find = () => query([
        { username: "OWN", accounts: ["O1"], ownerUserId: "admin", visibility: "public", active: true },
        { username: "ELSE", accounts: ["E1"], ownerUserId: "other", visibility: "public", active: true },
    ]);
    AccountConfig.find = () => query([
        { env: "O1", signals: ["ROSE"], trade_config: { ON: true } },
        { env: "E1", signals: ["BULL"], trade_config: { ON: true } },
    ]);
    TelegramClient.find = () => query([]);
    RuntimeLog.find = () => query([]);
    RuntimeLog.aggregate = async () => [];
    try {
        const view = await listSignalSetup(admin, {});
        assert.deepEqual(view.bots.map((row) => row.username), ["OWN"]);
        assert.deepEqual(view.catalog.map((row) => row.signal), ["ROSE"]);
    } finally {
        UserAccount.find = originals.users;
        AccountConfig.find = originals.configs;
        TelegramClient.find = originals.channels;
        RuntimeLog.find = originals.logs;
        RuntimeLog.aggregate = originals.aggregate;
    }
});

test("applySignals adds a signal onto the current list", async () => {
    const originals = { user: UserAccount.findOne, find: AccountConfig.find, one: AccountConfig.findOne, update: AccountConfig.updateOne };
    const updates = [];
    UserAccount.findOne = async () => ({ username: "V", accounts: ["V1"], ownerUserId: "admin", visibility: "public", active: true });
    AccountConfig.find = () => query([{ env: "V1", signals: ["ROSE"] }]);
    AccountConfig.findOne = () => query({
        env: "V1",
        signals: ["ROSE"],
        trade_config: { ON: true, LONG: true, MARGIN: { MODE: "FIX" } },
    });
    AccountConfig.updateOne = async (filter, doc) => {
        updates.push({ filter, doc });
        return { matchedCount: 1 };
    };
    try {
        const result = await applySignals(admin, "V", { envs: ["V1", "NO"], signals: ["tam"], action: "add" });
        assert.deepEqual(result.updated[0].signals, ["ROSE", "TAM"]);
        assert.equal(result.updated[0].changed, true);
        assert.equal(result.failed[0].env, "NO");
        assert.deepEqual(updates[0].doc.$set.signals, ["ROSE", "TAM"]);
        assert.equal(Object.hasOwn(updates[0].doc.$set, "trade_config"), false);
    } finally {
        UserAccount.findOne = originals.user;
        AccountConfig.find = originals.find;
        AccountConfig.findOne = originals.one;
        AccountConfig.updateOne = originals.update;
    }
});
