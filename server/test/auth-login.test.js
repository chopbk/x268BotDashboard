const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const WebUser = require("../src/models/web-user");
const { hashPassword } = require("../src/auth/password");
const router = require("../src/routes/auth");

function loginHandler() {
    return router.stack.find((layer) => layer.route?.path === "/login").route.stack[0].handle;
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

async function assertLogin(identifier, expectedQuery) {
    const originalFindOne = WebUser.findOne;
    const user = {
        _id: "507f1f77bcf86cd799439011",
        email: "user@example.com",
        username: "test.user",
        name: "User",
        passwordHash: await hashPassword("password123"),
        role: "pending",
        botUsernames: [],
        disabled: false,
    };
    let actualQuery;
    WebUser.findOne = async (query) => {
        actualQuery = query;
        return user;
    };

    try {
        const res = response();
        await loginHandler()({ body: { identifier, password: "password123" } }, res);
        assert.deepEqual(actualQuery, expectedQuery);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.username, "test.user");
        assert.ok(res.cookieValue?.value);
    } finally {
        WebUser.findOne = originalFindOne;
    }
}

test("login accepts a normalized email", async () => {
    await assertLogin(" USER@Example.com ", { email: "user@example.com" });
});

test("login accepts a normalized username", async () => {
    await assertLogin(" Test.User ", { username: "test.user" });
});
