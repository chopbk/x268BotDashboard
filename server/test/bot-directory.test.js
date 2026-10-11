const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const { requirePermission } = require("../src/middleware/auth");
const { PERMISSIONS } = require("../src/auth/access-control");
const {
    addAccount,
    copyAccount,
    createBot,
    deleteAccount,
    getBot,
    normalizeEnvName,
    updateBotAccess,
} = require("../src/lib/bot-directory");

function matchEnvFilter(filter, env) {
    const key = filter?.env;
    if (key == null) return false;
    if (typeof key === "string") return key.toUpperCase() === String(env).toUpperCase();
    if (key instanceof RegExp) return key.test(env);
    return false;
}

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

test("normalizeEnvName luôn uppercase", () => {
    assert.equal(normalizeEnvName("  b4r  "), "B4R");
});

test("operator cannot add a config on a bot outside scope", async () => {
    await assert.rejects(() => addAccount(operator, "beta", "beta2"), (error) => {
        assert.equal(error.status, 403);
        return true;
    });
});

test("addAccount lưu tên uppercase và gắn config đã có", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const bot = {
        username: "alpha",
        accounts: ["ALPHA"],
        async save() {
            this.saved = true;
        },
    };
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(bot);
        return query(null);
    };
    AccountConfig.findOne = (filter) => (matchEnvFilter(filter, "ALPHA2") ? query({ env: "ALPHA2" }) : query(null));
    AccountConfig.create = async () => {
        throw new Error("should not create");
    };
    try {
        const result = await addAccount(operator, "alpha", "alpha2");
        assert.deepEqual(result.accounts, ["ALPHA", "ALPHA2"]);
        assert.equal(bot.saved, true);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.create = originalCreate;
    }
});

test("addAccount từ chối trùng tên không phân biệt hoa thường", async () => {
    const originalFind = UserAccount.findOne;
    const bot = {
        username: "alpha",
        accounts: ["MYENV"],
        async save() {
            throw new Error("should not save");
        },
    };
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(bot);
        return query(null);
    };
    try {
        await assert.rejects(() => addAccount(operator, "alpha", "myenv"), (error) => {
            assert.equal(error.status, 409);
            return true;
        });
    } finally {
        UserAccount.findOne = originalFind;
    }
});

test("addAccount copyFrom chép trade+signal như /aa?copy=", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const bot = {
        username: "alpha",
        accounts: ["SRC"],
        async save() {
            this.saved = true;
        },
    };
    let created = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(bot);
        if (filter.accounts instanceof RegExp && filter.accounts.test("SRC")) {
            return query({ username: "alpha", accounts: ["SRC"] });
        }
        return query(null);
    };
    AccountConfig.findOne = (filter) => {
        if (matchEnvFilter(filter, "SRC")) {
            return query({
                env: "SRC",
                signals: ["ROSE"],
                blacklist: ["BTCUSDT"],
                trade_config: { ON: true, FIX_COST_AMOUNT: 50 },
            });
        }
        return query(null);
    };
    AccountConfig.create = async (doc) => {
        created = doc;
    };
    try {
        const result = await addAccount(operator, "alpha", "new1", undefined, { copyFrom: "src" });
        assert.deepEqual(result.accounts, ["SRC", "NEW1"]);
        assert.equal(created.env, "NEW1");
        assert.deepEqual(created.signals, ["ROSE"]);
        assert.equal(created.trade_config.FIX_COST_AMOUNT, 50);
        assert.equal(created.sync_from, null);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.create = originalCreate;
    }
});

test("addAccount copyFrom lấy config bot khác nếu được xem", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const admin = { role: "admin", id: "admin" };
    const target = {
        username: "alpha",
        accounts: ["ALPHA"],
        async save() {
            this.saved = true;
        },
    };
    let created = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(target);
        if (filter.username === "beta") return query({ username: "beta", accounts: ["OTHER"] });
        if (filter.accounts instanceof RegExp && filter.accounts.test("OTHER")) {
            return query({ username: "beta", accounts: ["OTHER"] });
        }
        return query(null);
    };
    AccountConfig.findOne = (filter) => {
        if (matchEnvFilter(filter, "OTHER")) {
            return query({ env: "OTHER", signals: ["BULL"], trade_config: { ON: false } });
        }
        return query(null);
    };
    AccountConfig.create = async (doc) => {
        created = doc;
    };
    try {
        const result = await addAccount(admin, "alpha", "copied", undefined, { copyFrom: "other" });
        assert.deepEqual(result.accounts, ["ALPHA", "COPIED"]);
        assert.equal(created.env, "COPIED");
        assert.deepEqual(created.signals, ["BULL"]);
        assert.equal(created.trade_config.ON, false);
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.create = originalCreate;
    }
});

test("deleteAccount removes the env and deletes an unowned config", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalDelete = AccountConfig.deleteOne;
    const bot = {
        username: "alpha",
        accounts: ["ALPHA", "ALPHA2"],
        async save() {
            this.saved = true;
        },
    };
    let deleted = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query(bot);
        return query(null);
    };
    AccountConfig.findOne = (filter) => (matchEnvFilter(filter, "ALPHA2") ? query({ env: "ALPHA2" }) : query(null));
    AccountConfig.deleteOne = async (filter) => {
        deleted = filter;
    };
    try {
        const result = await deleteAccount(operator, "alpha", "alpha2");
        assert.deepEqual(result.accounts, ["ALPHA"]);
        assert.deepEqual(deleted, { env: "ALPHA2" });
    } finally {
        UserAccount.findOne = originalFind;
        AccountConfig.findOne = originalConfigFind;
        AccountConfig.deleteOne = originalDelete;
    }
});

test("copyAccount clones the config onto the chosen user", async () => {
    const originalFind = UserAccount.findOne;
    const originalConfigFind = AccountConfig.findOne;
    const originalCreate = AccountConfig.create;
    const admin = { role: "admin", id: "admin" };
    const source = { username: "alpha", accounts: ["A1"] };
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
        if (matchEnvFilter(filter, "A1")) {
            return query({
                _id: "src",
                env: "A1",
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
        assert.deepEqual(result, { username: "beta", env: "A1COPY" });
        assert.equal(created.env, "A1COPY");
        assert.equal(created._id, undefined);
        assert.deepEqual(created.signals, ["SIGNAL_A"]);
        assert.deepEqual(created.blacklist, ["BTC"]);
        assert.equal(created.trade_config.ON, true);
        assert.equal(created.sync_from, null);
        assert.deepEqual(target.accounts, ["A1COPY"]);
        assert.equal(target.saved, true);
        assert.deepEqual(source.accounts, ["A1"]);
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
    const target = { username: "beta", accounts: ["KEEP"] };
    let updated = null;
    UserAccount.findOne = (filter) => {
        if (filter.username === "alpha") return query({ username: "alpha", accounts: ["A1"] });
        if (filter.username === "beta") return query(target);
        return query(null);
    };
    AccountConfig.findOne = (filter) => query(matchEnvFilter(filter, "A1") ? {
        env: "A1",
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
        assert.deepEqual(result, { username: "beta", env: "KEEP", replaced: true });
        assert.equal(updated.filter.env, "KEEP");
        assert.deepEqual(updated.doc.$set.signals, ["SIGNAL_A"]);
        assert.deepEqual(updated.doc.$set.whitelist, ["ETH"]);
        assert.equal(updated.doc.$set.trade_config.ON, true);
        assert.equal(updated.doc.$set.sync_from, null);
        assert.deepEqual(target.accounts, ["KEEP"]);
        await assert.rejects(
            () => copyAccount(admin, "alpha", "a1", "alpha", "a1", { replace: true }),
            (error) => error.status === 400
        );
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
        if (filter.username === "alpha") return query({ username: "alpha", accounts: ["A1"] });
        if (filter.username === "beta") return query(target);
        return query(null);
    };
    AccountConfig.findOne = (filter) => query(matchEnvFilter(filter, "A1") ? {
        env: "A1",
        signals: ["SIGNAL_A"],
        trade_config: { ON: true },
        sync_from: "other",
    } : null);
    AccountConfig.create = async (doc) => {
        created = doc;
    };
    try {
        const result = await copyAccount(admin, "alpha", "a1", "beta", "branch", { sync: true });
        assert.deepEqual(result, { username: "beta", env: "BRANCH" });
        assert.equal(created.env, "BRANCH");
        assert.equal(created.sync_from, "A1");
        assert.deepEqual(created.signals, ["SIGNAL_A"]);
        assert.deepEqual(target.accounts, ["BRANCH"]);
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
