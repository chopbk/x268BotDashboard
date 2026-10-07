const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserApi = require("../src/models/user-api");
const { requirePermission } = require("../src/middleware/auth");
const { PERMISSIONS } = require("../src/auth/access-control");
const { PUBLIC_PROJECT, listApis, createApi, updateApi, deleteApi } = require("../src/lib/user-api-directory");

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

function query(value) {
    return {
        select() {
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

const admin = { role: "admin", botUsernames: [] };
const scoped = {
    role: "operator",
    customPermissions: [PERMISSIONS.CREDENTIALS_VIEW, PERMISSIONS.CREDENTIALS_MANAGE],
    botUsernames: ["alpha"],
};

const publicRow = {
    username: "alpha",
    exchange: "binance",
    hedge_mode: true,
    test: false,
    sub_account: "",
    hasApiKey: true,
    hasApiSecret: true,
    hasPassword: false,
    updatedAt: null,
};

test("viewer cannot view credentials and operator cannot manage them", () => {
    const viewerRes = response();
    let viewerNext = false;
    requirePermission(PERMISSIONS.CREDENTIALS_VIEW)({ webUser: { role: "viewer" } }, viewerRes, () => {
        viewerNext = true;
    });
    assert.equal(viewerRes.statusCode, 403);
    assert.equal(viewerNext, false);

    const operatorRes = response();
    let operatorNext = false;
    requirePermission(PERMISSIONS.CREDENTIALS_MANAGE)(
        { webUser: { role: "operator" } },
        operatorRes,
        () => {
            operatorNext = true;
        }
    );
    assert.equal(operatorRes.statusCode, 403);
    assert.equal(operatorNext, false);
});

test("public user API projection does not select raw secrets", () => {
    assert.equal(Object.hasOwn(PUBLIC_PROJECT, "api_key"), false);
    assert.equal(Object.hasOwn(PUBLIC_PROJECT, "api_secret"), false);
    assert.equal(Object.hasOwn(PUBLIC_PROJECT, "password"), false);
    assert.equal(PUBLIC_PROJECT._id, 0);
});

test("listApis limits a non-admin to assigned bot usernames", async () => {
    const original = UserApi.aggregate;
    let match;
    UserApi.aggregate = async (pipeline) => {
        match = pipeline[0].$match;
        return [];
    };
    try {
        const rows = await listApis(scoped);
        assert.deepEqual(rows, []);
        assert.deepEqual(match, { username: { $in: ["alpha"] } });
    } finally {
        UserApi.aggregate = original;
    }
});

test("createApi stores secrets but returns only presence flags", async () => {
    const originalFind = UserApi.findOne;
    const originalCreate = UserApi.create;
    const originalAggregate = UserApi.aggregate;
    let stored;
    UserApi.findOne = () => query(null);
    UserApi.create = async (doc) => {
        stored = doc;
        return doc;
    };
    UserApi.aggregate = async () => [publicRow];
    try {
        const api = await createApi(admin, {
            username: "alpha",
            exchange: "binance",
            api_key: "raw-key",
            api_secret: "raw-secret",
        });
        assert.equal(stored.api_key, "raw-key");
        assert.equal(stored.api_secret, "raw-secret");
        assert.equal(JSON.stringify(api).includes("raw-key"), false);
        assert.equal(api.hasApiKey, true);
        assert.equal(api.username, "alpha");
    } finally {
        UserApi.findOne = originalFind;
        UserApi.create = originalCreate;
        UserApi.aggregate = originalAggregate;
    }
});

test("updateApi keeps the current key when the new key is blank", async () => {
    const originalFind = UserApi.findOne;
    const originalUpdate = UserApi.updateOne;
    const originalAggregate = UserApi.aggregate;
    let update;
    UserApi.findOne = () => query({ username: "alpha" });
    UserApi.updateOne = async (filter, doc) => {
        update = doc;
        return { matchedCount: 1 };
    };
    UserApi.aggregate = async () => [{ ...publicRow, exchange: "bybit" }];
    try {
        await updateApi(admin, "alpha", { exchange: "bybit", api_key: "  ", api_secret: "" });
        assert.equal(update.$set.exchange, "bybit");
        assert.equal(Object.hasOwn(update.$set, "api_key"), false);
        assert.equal(Object.hasOwn(update.$set, "api_secret"), false);
    } finally {
        UserApi.findOne = originalFind;
        UserApi.updateOne = originalUpdate;
        UserApi.aggregate = originalAggregate;
    }
});

test("scoped user cannot delete another username", async () => {
    const original = UserApi.deleteOne;
    let called = false;
    UserApi.deleteOne = async () => {
        called = true;
        return { deletedCount: 1 };
    };
    try {
        await assert.rejects(() => deleteApi(scoped, "beta"), (error) => {
            assert.equal(error.status, 403);
            return true;
        });
        assert.equal(called, false);
    } finally {
        UserApi.deleteOne = original;
    }
});
