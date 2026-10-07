const { permissionsForUser } = require("../auth/access-control");

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
        botUsernames: doc.botUsernames || [],
        disabled: !!doc.disabled,
    };
}

function sessionUser(doc) {
    return {
        id: String(doc._id || doc.id),
        email: doc.email,
        username: doc.username || null,
        telegramId: doc.telegramId || null,
        telegramUsername: doc.telegramUsername || null,
        phone: doc.phone || null,
        name: doc.name,
        role: doc.role,
        permissions: permissionsForUser(doc),
        botUsernames: doc.botUsernames || [],
    };
}

module.exports = { publicUser, sessionUser };
