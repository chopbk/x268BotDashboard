const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const WebUser = require("../src/models/web-user");
const AuditLog = require("../src/models/audit-log");
const router = require("../src/routes/auth");
const { PERMISSIONS, hasPermission, canAccessResource } = require("../src/auth/access-control");

function registerHandler() {
    return router.stack.find((layer) => layer.route?.path === "/register").route.stack[0].handle;
}

function response() {
    return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        cookie() { return this; },
        json(body) { this.body = body; return this; },
    };
}

test("registration -> admin approval -> owned resource access workflow stays fail-closed", async (t) => {
    const id = "507f1f77bcf86cd799439011";
    t.mock.method(WebUser, "create", async (input) => ({ _id: id, ...input }));
    t.mock.method(AuditLog, "create", async () => ({}));
    const res = response();
    await registerHandler()({ body: { name: "Member", username: "member.one", email: "member@example.com", password: "password123" } }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.role, "pending");
    assert.deepEqual(res.body.permissions, []);
    assert.equal(hasPermission(res.body, PERMISSIONS.BOTS_VIEW), false);

    const approved = { ...res.body, role: "member", permissionScopes: {} };
    assert.equal(hasPermission(approved, PERMISSIONS.BOTS_VIEW), true);
    assert.equal(canAccessResource(approved, PERMISSIONS.BOTS_VIEW, { username: "owned", ownerUserId: id, visibility: "private" }), true);
    assert.equal(canAccessResource(approved, PERMISSIONS.BOTS_VIEW, { username: "another", ownerUserId: "507f191e810c19729de860ea", visibility: "public" }), false);
});
