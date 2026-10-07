const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PERMISSIONS,
    permissionsForRole,
    permissionsForUser,
    hasPermission,
    scopeForPermission,
    canAccessResource,
    canManageWebUser,
} = require("../src/auth/access-control");

test("a user without custom permissions inherits the role template", () => {
    assert.deepEqual(
        permissionsForUser({ role: "viewer" }),
        permissionsForRole("viewer")
    );
});

test("custom permissions replace the role template", () => {
    const user = {
        role: "viewer",
        customPermissions: [PERMISSIONS.POSITIONS_VIEW, PERMISSIONS.CREDENTIALS_VIEW],
    };
    assert.deepEqual(permissionsForUser(user), [
        PERMISSIONS.POSITIONS_VIEW,
        PERMISSIONS.CREDENTIALS_VIEW,
        PERMISSIONS.USERS_EDIT,
        PERMISSIONS.USERS_RESET_PASSWORD,
    ]);
    assert.equal(hasPermission(user, PERMISSIONS.BOTS_VIEW), false);
    assert.equal(hasPermission(user, PERMISSIONS.CREDENTIALS_VIEW), true);
});

test("pending always has zero permissions even if stored data is inconsistent", () => {
    assert.deepEqual(
        permissionsForUser({
            role: "pending",
            customPermissions: [PERMISSIONS.USERS_MANAGE],
        }),
        []
    );
});

test("admin always has the full template even if custom permissions are empty", () => {
    const permissions = permissionsForUser({ role: "admin", customPermissions: [] });
    assert.deepEqual(permissions, permissionsForRole("admin"));
    assert.equal(permissions.includes(PERMISSIONS.USERS_MANAGE), true);
    assert.equal(permissions.includes(PERMISSIONS.CREDENTIALS_VIEW), true);
});

test("unknown custom permissions fail closed", () => {
    assert.deepEqual(
        permissionsForUser({ role: "viewer", customPermissions: ["unknown.permission"] }),
        [PERMISSIONS.USERS_EDIT, PERMISSIONS.USERS_RESET_PASSWORD]
    );
});

test("view and edit scopes are independent for the same config", () => {
    const user = {
        role: "viewer",
        customPermissions: [PERMISSIONS.CONFIG_VIEW, PERMISSIONS.CONFIG_EDIT],
        permissionScopes: { [PERMISSIONS.CONFIG_VIEW]: "all", [PERMISSIONS.CONFIG_EDIT]: "assigned" },
        botUsernames: ["alpha"],
    };
    assert.equal(canAccessResource(user, PERMISSIONS.CONFIG_VIEW, "beta"), true);
    assert.equal(canAccessResource(user, PERMISSIONS.CONFIG_EDIT, "beta"), false);
    assert.equal(canAccessResource(user, PERMISSIONS.CONFIG_EDIT, "alpha"), true);
});

test("legacy users without stored scopes default bot resources to assigned", () => {
    const user = { role: "viewer", botUsernames: ["alpha"] };
    assert.equal(scopeForPermission(user, PERMISSIONS.CONFIG_VIEW), "assigned");
    assert.equal(canAccessResource(user, PERMISSIONS.CONFIG_VIEW, "alpha"), true);
    assert.equal(canAccessResource(user, PERMISSIONS.CONFIG_VIEW, "beta"), false);
});

test("API view scope can be all without granting API management", () => {
    const user = { role: "viewer", customPermissions: [PERMISSIONS.CREDENTIALS_VIEW], permissionScopes: { [PERMISSIONS.CREDENTIALS_VIEW]: "all" } };
    assert.equal(canAccessResource(user, PERMISSIONS.CREDENTIALS_VIEW, "any-bot"), true);
    assert.equal(canAccessResource(user, PERMISSIONS.CREDENTIALS_MANAGE, "any-bot"), false);
});

test("new role templates map own, assigned and all scopes independently", () => {
    assert.equal(scopeForPermission({ role: "member" }, PERMISSIONS.CONFIG_VIEW), "own");
    assert.equal(scopeForPermission({ role: "collaborator" }, PERMISSIONS.CONFIG_VIEW), "own_assigned");
    assert.equal(scopeForPermission({ role: "collaborator" }, PERMISSIONS.CONFIG_EDIT), "own");
    assert.equal(scopeForPermission({ role: "operator" }, PERMISSIONS.CONFIG_EDIT), "own_assigned");
    assert.equal(scopeForPermission({ role: "supervisor" }, PERMISSIONS.CONFIG_VIEW), "all");
    assert.equal(scopeForPermission({ role: "supervisor" }, PERMISSIONS.CONFIG_EDIT), "own");
    assert.equal(hasPermission({ role: "summary_viewer" }, PERMISSIONS.SUMMARY_VIEW), true);
    assert.equal(scopeForPermission({ role: "viewer" }, PERMISSIONS.USERS_EDIT), "own");
    assert.equal(scopeForPermission({ role: "member" }, PERMISSIONS.USERS_RESET_PASSWORD), "own");
    assert.equal(hasPermission({ role: "pending" }, PERMISSIONS.USERS_EDIT), false);
    assert.equal(canManageWebUser({ role: "member", id: "member-id", username: "507f1f77bcf86cd799439011" }, PERMISSIONS.USERS_EDIT), false);
    assert.equal(canManageWebUser({ role: "admin" }, PERMISSIONS.USERS_RESET_PASSWORD), true);
});

test("private admin bot is hidden from ordinary all-scope users unless explicitly assigned", () => {
    const privateBot = { username: "admin-secret", ownerUserId: "admin-id", visibility: "private" };
    const supervisor = { id: "user-id", role: "supervisor", botUsernames: [] };
    assert.equal(canAccessResource(supervisor, PERMISSIONS.BOTS_VIEW, privateBot), false);
    supervisor.botUsernames.push("admin-secret");
    assert.equal(canAccessResource(supervisor, PERMISSIONS.BOTS_VIEW, privateBot), true);
    assert.equal(canAccessResource({ id: "admin-id", role: "admin" }, PERMISSIONS.BOTS_VIEW, privateBot), true);
});

test("own scope uses the bot owner relationship instead of its username", () => {
    const member = { id: "member-id", role: "member", botUsernames: [] };
    assert.equal(canAccessResource(member, PERMISSIONS.CONFIG_VIEW, { username: "strategy-a", ownerUserId: "member-id" }), true);
    assert.equal(canAccessResource(member, PERMISSIONS.CONFIG_VIEW, { username: "strategy-b", ownerUserId: "other-id" }), false);
});

test("roles that can inspect config also receive scoped signal history", () => {
    assert.equal(hasPermission({ role: "member" }, PERMISSIONS.SIGNALS_HISTORY), true);
    assert.equal(scopeForPermission({ role: "member" }, PERMISSIONS.SIGNALS_HISTORY), "own");
    assert.equal(scopeForPermission({ role: "operator" }, PERMISSIONS.SIGNALS_HISTORY), "own_assigned");
    assert.equal(scopeForPermission({ role: "auditor" }, PERMISSIONS.SIGNALS_HISTORY), "all");
    assert.equal(scopeForPermission({ role: "member" }, PERMISSIONS.STATISTICS_VIEW), "own");
});
