const { permissionsForUser, plainScopes, scopeForPermission } = require("../auth/access-control");

function publicUser(doc) {
    return {
        id: String(doc._id),
        email: doc.email,
        username: doc.username || null,
        telegramId: doc.telegramId || null,
        telegramUsername: doc.telegramUsername || null,
        phone: doc.phone || null,
        name: doc.name,
        role: doc.role,
        permissions: permissionsForUser(doc),
        customPermissions: Array.isArray(doc.customPermissions) ? doc.customPermissions : null,
        permissionScopes: plainScopes(doc.permissionScopes),
        botUsernames: doc.botUsernames || [],
        disabled: !!doc.disabled,
    };
}

function sessionUser(doc) {
    const actor = {
        id: String(doc._id || doc.id),
        role: doc.role,
        customPermissions: doc.customPermissions,
        permissionScopes: plainScopes(doc.permissionScopes),
    };
    const permissions = permissionsForUser(doc);
    const scopes = {};
    for (const permission of permissions) scopes[permission] = scopeForPermission(actor, permission);
    return {
        id: actor.id,
        email: doc.email,
        username: doc.username || null,
        telegramId: doc.telegramId || null,
        telegramUsername: doc.telegramUsername || null,
        phone: doc.phone || null,
        name: doc.name,
        role: doc.role,
        permissions,
        scopes,
        permissionScopes: actor.permissionScopes,
        botUsernames: doc.botUsernames || [],
    };
}

module.exports = { publicUser, sessionUser };
