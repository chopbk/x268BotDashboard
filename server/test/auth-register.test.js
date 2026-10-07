const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const WebUser = require("../src/models/web-user");
const AuditLog = require("../src/models/audit-log");
const { hashPassword } = require("../src/auth/password");
const router = require("../src/routes/auth");

function registerHandler() {
    return router.stack.find((layer) => layer.route?.path === "/register").route.stack[0].handle;
}

function response() {
    return {
        statusCode: 200,
        body: null,
        cookieValue: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        cookie(name, value) {
            this.cookieValue = { name, value };
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

test("a duplicate pending registration with the same password resumes login", async () => {
    const originalCreate = WebUser.create;
    const originalFindOne = WebUser.findOne;
    const passwordHash = await hashPassword("password123");
    const existing = {
        _id: "507f1f77bcf86cd799439011",
        email: "user@example.com",
        username: "test.user",
        name: "User",
        passwordHash,
        role: "pending",
        botUsernames: [],
        disabled: false,
    };

    WebUser.create = async () => {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
    };
    WebUser.findOne = async () => existing;

    try {
        const res = response();
        await registerHandler()(
            {
                body: {
                    name: "User",
                    username: "Test.User",
                    email: "USER@example.com",
                    password: "password123",
                },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.email, "user@example.com");
        assert.equal(res.body.username, "test.user");
        assert.equal(res.body.role, "pending");
        assert.deepEqual(res.body.permissions, []);
        assert.ok(res.cookieValue?.value);
    } finally {
        WebUser.create = originalCreate;
        WebUser.findOne = originalFindOne;
    }
});

test("a duplicate registration with a different password stays rejected", async () => {
    const originalCreate = WebUser.create;
    const originalFindOne = WebUser.findOne;
    const existing = {
        _id: "507f1f77bcf86cd799439011",
        email: "user@example.com",
        username: "test.user",
        passwordHash: await hashPassword("original-password"),
        role: "pending",
        disabled: false,
    };

    WebUser.create = async () => {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
    };
    WebUser.findOne = async () => existing;

    try {
        const res = response();
        await registerHandler()(
            {
                body: {
                    name: "User",
                    username: "test.user",
                    email: "user@example.com",
                    password: "wrong-password",
                },
            },
            res
        );

        assert.equal(res.statusCode, 409);
        assert.deepEqual(res.body, { error: "Email hoặc username đã được sử dụng" });
        assert.equal(res.cookieValue, null);
    } finally {
        WebUser.create = originalCreate;
        WebUser.findOne = originalFindOne;
    }
});

test("a retry can attach a username to a legacy pending account", async () => {
    const originalCreate = WebUser.create;
    const originalFindOne = WebUser.findOne;
    const originalAuditCreate = AuditLog.create;
    const existing = {
        _id: "507f1f77bcf86cd799439011",
        email: "legacy@example.com",
        name: "Legacy",
        passwordHash: await hashPassword("password123"),
        role: "pending",
        botUsernames: [],
        disabled: false,
        async save() {
            this.saved = true;
        },
    };

    WebUser.create = async () => {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
    };
    WebUser.findOne = async (filter) => (filter.email ? existing : null);
    AuditLog.create = async (entry) => entry;

    try {
        const res = response();
        await registerHandler()(
            {
                body: {
                    name: "Legacy",
                    username: "legacy.user",
                    email: "legacy@example.com",
                    password: "password123",
                },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(existing.username, "legacy.user");
        assert.equal(existing.saved, true);
        assert.equal(res.body.username, "legacy.user");
    } finally {
        WebUser.create = originalCreate;
        WebUser.findOne = originalFindOne;
        AuditLog.create = originalAuditCreate;
    }
});
