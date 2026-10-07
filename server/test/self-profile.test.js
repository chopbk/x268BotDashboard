const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const WebUser = require("../src/models/web-user");
const AuditLog = require("../src/models/audit-log");
const { hashPassword } = require("../src/auth/password");
const { updateSelfProfile } = require("../src/lib/self-profile");

const actor = { id: "me", email: "me@x268.com", username: "me", role: "member", name: "Me" };

test("a signed-in user can update their own profile and password", async () => {
    const originalFind = WebUser.findById;
    const originalAudit = AuditLog.create;
    const passwordHash = await hashPassword("old-password");
    const doc = {
        _id: "me",
        email: "me@x268.com",
        username: "me",
        name: "Me",
        role: "member",
        passwordHash,
        telegramId: undefined,
        telegramUsername: undefined,
        phone: undefined,
        async save() {
            this.saved = true;
        },
    };
    WebUser.findById = async () => doc;
    AuditLog.create = async () => ({});
    try {
        const updated = await updateSelfProfile(actor, {
            name: "Me Two",
            telegramUsername: "@MeUser",
            phone: "+84901234567",
            currentPassword: "old-password",
            password: "new-password",
        });
        assert.equal(doc.saved, true);
        assert.equal(doc.name, "Me Two");
        assert.equal(doc.telegramUsername, "meuser");
        assert.equal(doc.phone, "+84901234567");
        assert.notEqual(doc.passwordHash, passwordHash);
        assert.equal(updated.name, "Me Two");
        assert.equal(updated.passwordHash, undefined);
        await assert.rejects(
            () => updateSelfProfile({ ...actor, role: "pending" }, { name: "Nope" }),
            (error) => error.status === 403
        );
        await assert.rejects(
            () => updateSelfProfile(actor, { currentPassword: "wrong", password: "another-password" }),
            (error) => error.status === 400
        );
    } finally {
        WebUser.findById = originalFind;
        AuditLog.create = originalAudit;
    }
});
