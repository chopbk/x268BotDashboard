const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const { requirePermission } = require("../src/middleware/auth");
const { PERMISSIONS } = require("../src/auth/access-control");
const { addAccount, copyAccount, createBot, deleteAccount, getBot, updateBotAccess } = require("../src/lib/bot-directory");

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

const operator = { role: "operator", botUsernames: ["alpha"] };

function query(value) {
    return {
        select() {
            return this;
        },
        sort() {
            return this;
        },
        lean() {
            return Promise.resolve(value);
        },
        then(onOk, onErr) {
            return Promise.resolve(value).then(onOk, onErr);
        },
    };
}

test("viewer is denied config.edit and operator is denied users.manage", () => {
    const viewerRes = response();
    let viewerNext = false;
    requirePermission(PERMISSIONS.CONFIG_EDIT)({ webUser: { role: "viewer" } }, viewerRes, () => {
        viewerNext = true;
    });
    assert.equal(viewerRes.statusCode, 403);
    assert.equal(viewerNext, false);

    const operatorRes = response();
    let operatorNext = false;
    requirePermission(PERMISSIONS.USERS_MANAGE)({ webUser: operator }, operatorRes, () => {
        operatorNext = true;
    });
    assert.equal(operatorRes.statusCode, 403);
    assert.equal(operatorNext, false);

    const allowed = response();
    let allowedNext = false;
    requirePermission(PERMISSIONS.CONFIG_EDIT)({ webUser: operator }, allowed, () => {
        allowedNext = true;
    });
    assert.equal(allowedNext, true);
    assert.equal(allowed.statusCode, 200);
});

test("getBot loads one user by exact name even when the list is paged", async () => {
    const originalFind = UserAccount.findOne;
    UserAccount.findOne = (filter) => query(filter.username === "V" ? {
        username: "V",
        accounts: ["v1"],
        visibility: "public",
        active: true,
        ownerUserId: "owner",
    } : null);
    try {
        const bot = await getBot({ role: "supervisor", id: "vx268", botUsernames: [] }, "V");
        assert.equal(bot.username, "V");
        assert.deepEqual(bot.accounts, ["v1"]);
        await assert.rejects(() => getBot({ role: "member", id: "other", botUsernames: [] }, "V"), (error) => error.status === 403);
        await assert.rejects(() => getBot({ role: "admin", id: "admin" }, "missing"), (error) => error.status === 404);
    } finally {
        UserAccount.findOne = originalFind;
    }
});

test("operator cannot add a config on a bot outside scope", async () => {
    await assert.rejects(() => addAccount(operator, "beta", "beta2"), (error) => {
        assert.equal(error.status, 403);
        return true;
    });
});

test("addAccount links an existing config without creating another", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const bot = {
        username: "alpha",
        accounts: ["alpha"],
        async save() {
            this.saved = true;
        },
    };
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(bot);
        return query(null);
    };
    AccountConfig.findOne = () => query({ env: "alpha2" });
    AccountConfig.create = async () => {
        throw new Error("should not create");
    };
    try {
        const result = await addAccount(operator, "alpha", "alpha2");
        assert.deepEqual(result.accounts, ["alpha", "alpha2"]);
        assert.equal(bot.saved, true);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.create = originalCreate;
    }
});

test("deleteAccount removes the env and deletes an unowned config", async () => {
    const originalFind = UserAccount.findOne;
    const originalDelete = AccountConfig.deleteOne;
    const bot = {
        username: "alpha",
        accounts: ["alpha", "alpha2"],
        async save() {
            this.saved = true;
        },
    };
    let deleted = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(bot);
        return query(null);
    };
    AccountConfig.deleteOne = async (filter) => {
        deleted = filter;
    };
    try {
        const result = await deleteAccount(operator, "alpha", "alpha2");
        assert.deepEqual(result.accounts, ["alpha"]);
        assert.deepEqual(deleted, { env: "alpha2" });
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.deleteOne = originalDelete;
    }
});

test("copyAccount clones the config onto the chosen user", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const admin = { role: "admin", id: "admin" };
    const source = { username: "alpha", accounts: ["a1"] };
    const target = {
        username: "beta",
        accounts: [],
        async save() {
            this.saved = true;
        },
    };
    let created = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(source);
        if (filter.username === "beta") return query(target);
        return query(null);
    };
    AccountConfig.findOne = (filter) => {
        if (filter.env === "a1") {
            return query({
                _id: "src",
                env: "a1",
                signals: ["SIGNAL_A"],
                blacklist: ["BTC"],
                trade_config: { ON: true, FIX_COST_AMOUNT: 100 },
                sync_from: "old",
                createdAt: new Date(),
            });
        }
        return query(null);
    };
    AccountConfig.create = async (doc) => {
        created = doc;
    };
    try {
        const result = await copyAccount(admin, "alpha", "a1", "beta", "a1copy");
        assert.deepEqual(result, { username: "beta", env: "a1copy" });
        assert.equal(created.env, "a1copy");
        assert.equal(created._id, undefined);
        assert.deepEqual(created.signals, ["SIGNAL_A"]);
        assert.deepEqual(created.blacklist, ["BTC"]);
        assert.equal(created.trade_config.ON, true);
        assert.equal(created.sync_from, null);
        assert.deepEqual(target.accounts, ["a1copy"]);
        assert.equal(target.saved, true);
        assert.deepEqual(source.accounts, ["a1"]);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.create = originalCreate;
    }
});

test("copyAccount overwrites an existing config and clears its sync", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalUpdate = AccountConfig.updateOne;
    const admin = { role: "admin", id: "admin" };
    const target = { username: "beta", accounts: ["keep"] };
    let updated = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query({ username: "alpha", accounts: ["a1"] });
        if (filter.username === "beta") return query(target);
        return query(null);
    };
    AccountConfig.findOne = (filter) => query(filter.env === "a1" ? {
        env: "a1",
        signals: ["SIGNAL_A"],
        blacklist: ["BTC"],
        whitelist: ["ETH"],
        trade_config: { ON: true },
        sync_from: "old",
    } : null);
    AccountConfig.updateOne = async (filter, doc) => {
        updated = { filter, doc };
        return { matchedCount: 1 };
    };
    try {
        const result = await copyAccount(admin, "alpha", "a1", "beta", "keep", { replace: true });
        assert.deepEqual(result, { username: "beta", env: "keep", replaced: true });
        assert.equal(updated.filter.env, "keep");
        assert.deepEqual(updated.doc.$set.signals, ["SIGNAL_A"]);
        assert.deepEqual(updated.doc.$set.whitelist, ["ETH"]);
        assert.equal(updated.doc.$set.trade_config.ON, true);
        assert.equal(updated.doc.$set.sync_from, null);
        assert.deepEqual(target.accounts, ["keep"]);
        await assert.rejects(() => copyAccount(admin, "alpha", "a1", "beta", "a1", { replace: true }), (error) => error.status === 400);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.updateOne = originalUpdate;
    }
});

test("copyAccount can create a new config that stays synced to the source", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const admin = { role: "admin", id: "admin" };
    const target = {
        username: "beta",
        accounts: [],
        async save() {
            this.saved = true;
        },
    };
    let created = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query({ username: "alpha", accounts: ["a1"] });
        if (filter.username === "beta") return query(target);
        return query(null);
    };
    AccountConfig.findOne = (filter) => query(filter.env === "a1" ? {
        env: "a1",
        signals: ["SIGNAL_A"],
        trade_config: { ON: true },
        sync_from: "other",
    } : null);
    AccountConfig.create = async (doc) => {
        created = doc;
    };
    try {
        const result = await copyAccount(admin, "alpha", "a1", "beta", "branch", { sync: true });
        assert.deepEqual(result, { username: "beta", env: "branch" });
        assert.equal(created.env, "branch");
        assert.equal(created.sync_from, "a1");
        assert.deepEqual(created.signals, ["SIGNAL_A"]);
        assert.deepEqual(target.accounts, ["branch"]);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.create = originalCreate;
    }
});

test("copyAccount rejects a target outside scope before writing", async () => {
    const originalFind = UserAccount.findOne;
    const originalCreate = AccountConfig.create;
    let created = false;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query({ username: "alpha", accounts: ["a1"] });
        return query(null);
    };
    AccountConfig.create = async () => {
        created = true;
    };
    try {
        await assert.rejects(() => copyAccount(operator, "alpha", "a1", "beta", "a1copy"), (error) => {
            assert.equal(error.status, 403);
            return true;
        });
        assert.equal(created, false);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.create = originalCreate;
    }
});

test("updateBotAccess stores the active flag and rejects a non-boolean", async () => {
    const originalFind = UserAccount.findOne;
    const bot = {
        username: "alpha",
        accounts: [],
        visibility: "public",
        active: true,
        async save() {
            this.saved = true;
        },
    };
    const admin = { role: "admin", id: "admin", botUsernames: [] };
    UserAccount.findOne = (filter) => (filter.username === "alpha" ? query(bot) : query(null));
    try {
        const turnedOff = await updateBotAccess(admin, "alpha", { active: false });
        assert.equal(bot.active, false);
        assert.equal(bot.saved, true);
        assert.equal(turnedOff.active, false);
        await assert.rejects(() => updateBotAccess(admin, "alpha", { active: "no" }), (error) => {
            assert.equal(error.status, 400);
            return true;
        });
    } finally {
        UserAccount.findOne = originalFind;
    }
});

test("createBot rejects a duplicate username", async () => {
    const originalFind = UserAccount.findOne;
    UserAccount.findOne = () => query({ username: "alpha", accounts: [] });
    try {
        await assert.rejects(() => createBot(operator, "alpha"), (error) => {
            assert.equal(error.status, 409);
            return true;
        });
    } finally {
        UserAccount.findOne = originalFind;
    }
});
