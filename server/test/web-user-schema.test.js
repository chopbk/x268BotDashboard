const test = require("node:test");
const assert = require("node:assert/strict");
const WebUser = require("../src/models/web-user");

test("permission scopes accept dotted permission keys", () => {
    const user = new WebUser({
        email: "scope@example.com",
        username: "scope-user",
        passwordHash: "not-used-in-this-test",
        name: "Scope user",
        role: "viewer",
        customPermissions: ["config.view", "config.edit"],
        permissionScopes: {
            "config.view": "all",
            "config.edit": "assigned",
        },
    });

    assert.equal(user.validateSync(), undefined);
    assert.deepEqual(user.permissionScopes, {
        "config.view": "all",
        "config.edit": "assigned",
    });
});
