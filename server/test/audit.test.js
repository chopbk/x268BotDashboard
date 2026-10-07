const test = require("node:test");
const assert = require("node:assert/strict");

const {
    NEVER_LOG_FIELDS,
    identity,
    maskPhone,
    sanitizeAuditValue,
    buildChanges,
} = require("../src/lib/audit");

test("audit identity contains only safe identifying fields", () => {
    assert.deepEqual(
        identity({
            id: "user-id",
            email: "user@example.com",
            username: "test.user",
            name: "Test User",
            passwordHash: "must-not-leak",
            phone: "+84901234567",
        }),
        {
            id: "user-id",
            email: "user@example.com",
            username: "test.user",
            name: "Test User",
            type: "user",
        }
    );
});

test("audit changes omit secrets and mask phone numbers", () => {
    const changes = buildChanges(
        { phone: "+84901234567", passwordHash: "old", role: "viewer" },
        { phone: "+84907654321", passwordHash: "new", role: "operator" },
        ["phone", "passwordHash", "role"]
    );

    assert.deepEqual(changes, {
        phone: { from: "***4567", to: "***4321" },
        role: { from: "viewer", to: "operator" },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(changes, "passwordHash"), false);
});

test("known secret fields can never be serialized as audit values", () => {
    for (const field of NEVER_LOG_FIELDS) {
        assert.equal(sanitizeAuditValue(field, "secret-value"), undefined);
    }
    assert.equal(maskPhone(null), null);
});
