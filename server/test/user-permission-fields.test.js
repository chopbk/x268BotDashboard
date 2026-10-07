const test = require("node:test");
const assert = require("node:assert/strict");
const { hasAccessAssignmentFields } = require("../src/lib/user-permission-fields");

test("basic user creation fields do not require permission assignment access", () => {
    assert.equal(hasAccessAssignmentFields({
        name: "Viewer",
        username: "viewer",
        email: "viewer@example.com",
        password: "password",
    }), false);
});

test("role, permissions, scopes and bot assignment are privileged create fields", () => {
    for (const field of ["role", "customPermissions", "permissionScopes", "botUsernames"]) {
        assert.equal(hasAccessAssignmentFields({ [field]: field === "role" ? "viewer" : [] }), true);
    }
});
