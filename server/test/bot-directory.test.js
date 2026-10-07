const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const { requirePermission } = require("../src/middleware/auth");
const { PERMISSIONS } = require("../src/auth/access-control");
const { addAccount, createBot, deleteAccount } = require("../src/lib/bot-directory");

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

test("createBot rejects a duplicate username", async () => {
    const originalFind = UserAccount.findOne;
    UserAccount.findOne = () => query({ username: "alpha", accounts: [] });
    try {
        await assert.rejects(() => createBot("alpha"), (error) => {
            assert.equal(error.status, 409);
            return true;
        });
    } finally {
        UserAccount.findOne = originalFind;
    }
});
