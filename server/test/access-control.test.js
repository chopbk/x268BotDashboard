const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PERMISSIONS,
    permissionsForRole,
    permissionsForUser,
    hasPermission,
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
        []
    );
});
