const SCOPES = Object.freeze({ ALL: "all", ASSIGNED: "assigned", OWN: "own", OWN_ASSIGNED: "own_assigned" });
const PERMISSIONS = Object.freeze({
    SUMMARY_VIEW: "summary.view",
    BOTS_VIEW: "bots.view", BOTS_CREATE: "bots.create", BOTS_EDIT: "bots.edit", BOTS_DELETE: "bots.delete", BOTS_OPERATE: "bots.operate",
    CONFIG_VIEW: "config.view", CONFIG_EDIT: "config.edit",
    POSITIONS_VIEW: "positions.view", POSITIONS_OPEN: "positions.open", POSITIONS_CLOSE: "positions.close",
    CREDENTIALS_VIEW: "credentials.view", CREDENTIALS_MANAGE: "credentials.manage",
    USERS_VIEW: "users.view", USERS_CREATE: "users.create", USERS_EDIT: "users.edit", USERS_PERMISSIONS: "users.permissions",
    USERS_DISABLE: "users.disable", USERS_RESET_PASSWORD: "users.reset_password", LOGS_VIEW: "logs.view",
    USERS_MANAGE: "users.manage", SIGNALS_VIEW: "signals.view", SIGNALS_MANAGE: "signals.manage",
});
const DEFINITIONS = [
    [PERMISSIONS.SUMMARY_VIEW, "Xem tổng kết hệ thống", "summary", [SCOPES.ALL]],
    [PERMISSIONS.BOTS_VIEW, "Xem bot", "bot", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.BOTS_CREATE, "Tạo bot", "bot", [SCOPES.ALL]], [PERMISSIONS.BOTS_EDIT, "Sửa bot", "bot", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.BOTS_DELETE, "Xóa bot", "bot", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]], [PERMISSIONS.BOTS_OPERATE, "Vận hành bot", "bot", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.CONFIG_VIEW, "Xem config (gồm signal, cấu hình và blacklist)", "config", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.CONFIG_EDIT, "Sửa config (gồm signal, cấu hình và blacklist)", "config", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.POSITIONS_VIEW, "Xem position", "position", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.POSITIONS_OPEN, "Mở position", "position", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]], [PERMISSIONS.POSITIONS_CLOSE, "Đóng position", "position", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.CREDENTIALS_VIEW, "Xem API/credential", "api", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.CREDENTIALS_MANAGE, "Sửa API/credential", "api", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
    [PERMISSIONS.USERS_VIEW, "Xem người dùng", "user", [SCOPES.ALL, SCOPES.OWN]], [PERMISSIONS.USERS_CREATE, "Tạo người dùng", "user", [SCOPES.ALL]],
    [PERMISSIONS.USERS_EDIT, "Sửa thông tin người dùng", "user", [SCOPES.ALL, SCOPES.OWN]], [PERMISSIONS.USERS_PERMISSIONS, "Cấp quyền người dùng", "user", [SCOPES.ALL]],
    [PERMISSIONS.USERS_DISABLE, "Khóa người dùng", "user", [SCOPES.ALL]], [PERMISSIONS.USERS_RESET_PASSWORD, "Đặt lại mật khẩu", "user", [SCOPES.ALL, SCOPES.OWN]],
    [PERMISSIONS.LOGS_VIEW, "Xem log", "log", [SCOPES.ALL, SCOPES.OWN_ASSIGNED, SCOPES.ASSIGNED, SCOPES.OWN]],
].map(([key, label, group, allowedScopes]) => Object.freeze({ key, label, group, allowedScopes }));
const PERMISSION_DEFINITIONS = Object.freeze(Object.fromEntries(DEFINITIONS.map((item) => [item.key, item])));
const PERMISSION_LABELS = Object.freeze(Object.fromEntries(DEFINITIONS.map(({ key, label }) => [key, label])));
const LEGACY_USER_PERMISSIONS = [PERMISSIONS.USERS_VIEW, PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_EDIT, PERMISSIONS.USERS_PERMISSIONS, PERMISSIONS.USERS_DISABLE, PERMISSIONS.USERS_RESET_PASSWORD];
const VIEWER_PERMISSIONS = [PERMISSIONS.BOTS_VIEW, PERMISSIONS.CONFIG_VIEW, PERMISSIONS.POSITIONS_VIEW];
const OPERATOR_PERMISSIONS = [...VIEWER_PERMISSIONS, PERMISSIONS.BOTS_OPERATE, PERMISSIONS.CONFIG_EDIT, PERMISSIONS.POSITIONS_OPEN, PERMISSIONS.POSITIONS_CLOSE, PERMISSIONS.LOGS_VIEW];
const ROLE_PERMISSIONS = Object.freeze({
    admin: Object.freeze([...Object.keys(PERMISSION_DEFINITIONS), PERMISSIONS.USERS_MANAGE]),
    supervisor: Object.freeze(OPERATOR_PERMISSIONS), auditor: Object.freeze([...VIEWER_PERMISSIONS, PERMISSIONS.LOGS_VIEW]),
    operator: Object.freeze(OPERATOR_PERMISSIONS), collaborator: Object.freeze(OPERATOR_PERMISSIONS), trader: Object.freeze(OPERATOR_PERMISSIONS),
    member: Object.freeze(VIEWER_PERMISSIONS), summary_viewer: Object.freeze([PERMISSIONS.SUMMARY_VIEW]),
    viewer: Object.freeze(VIEWER_PERMISSIONS), user: Object.freeze(VIEWER_PERMISSIONS), pending: Object.freeze([]),
});
const ROLE_LABELS = Object.freeze({ pending: "Chờ duyệt", summary_viewer: "Chỉ xem tổng kết", member: "Xem dữ liệu của mình", trader: "Vận hành dữ liệu của mình", collaborator: "Sửa của mình, xem user được gán", operator: "Sửa của mình và user được gán", supervisor: "Sửa của mình, xem tất cả", auditor: "Kiểm toán - xem tất cả", admin: "Quản trị hệ thống", viewer: "Viewer (legacy)", user: "User (legacy)" });
const scopeMap = (permissions, scope) => Object.freeze(Object.fromEntries(permissions.map((permission) => [permission, scope])));
const ROLE_SCOPES = Object.freeze({
    admin: Object.freeze({}), summary_viewer: Object.freeze({ [PERMISSIONS.SUMMARY_VIEW]: SCOPES.ALL }),
    member: scopeMap(VIEWER_PERMISSIONS, SCOPES.OWN), trader: scopeMap(OPERATOR_PERMISSIONS, SCOPES.OWN),
    collaborator: Object.freeze({ ...scopeMap(VIEWER_PERMISSIONS, SCOPES.OWN_ASSIGNED), ...scopeMap(OPERATOR_PERMISSIONS.filter((p) => !VIEWER_PERMISSIONS.includes(p)), SCOPES.OWN) }),
    operator: scopeMap(OPERATOR_PERMISSIONS, SCOPES.OWN_ASSIGNED),
    supervisor: Object.freeze({ ...scopeMap(VIEWER_PERMISSIONS, SCOPES.ALL), ...scopeMap(OPERATOR_PERMISSIONS.filter((p) => !VIEWER_PERMISSIONS.includes(p)), SCOPES.OWN) }),
    auditor: scopeMap([...VIEWER_PERMISSIONS, PERMISSIONS.LOGS_VIEW], SCOPES.ALL),
    viewer: scopeMap(VIEWER_PERMISSIONS, SCOPES.ASSIGNED), user: scopeMap(VIEWER_PERMISSIONS, SCOPES.ASSIGNED), pending: Object.freeze({}),
});
const ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));
function permissionsForRole(role) { return ROLE_PERMISSIONS[role] || []; }
function isPermission(permission) { return !!PERMISSION_DEFINITIONS[permission] || Object.values(PERMISSIONS).includes(permission); }
function expandLegacy(items) {
    const result = new Set(items);
    if (result.has(PERMISSIONS.USERS_MANAGE)) LEGACY_USER_PERMISSIONS.forEach((item) => result.add(item));
    if (result.has(PERMISSIONS.SIGNALS_VIEW)) result.add(PERMISSIONS.CONFIG_VIEW);
    if (result.has(PERMISSIONS.SIGNALS_MANAGE)) result.add(PERMISSIONS.CONFIG_EDIT);
    return [...result].filter((item) => !!PERMISSION_DEFINITIONS[item]);
}
function permissionsForUser(user) {
    if (!user || user.role === "pending") return [];
    if (user.role === "admin") return permissionsForRole("admin");
    return expandLegacy(Array.isArray(user.customPermissions) ? user.customPermissions.filter(isPermission) : permissionsForRole(user.role));
}
function hasPermission(user, permission) {
    const effective = permissionsForUser(user);
    if (permission === PERMISSIONS.USERS_MANAGE) return LEGACY_USER_PERMISSIONS.every((item) => effective.includes(item));
    if (permission === PERMISSIONS.SIGNALS_VIEW) return effective.includes(PERMISSIONS.CONFIG_VIEW);
    if (permission === PERMISSIONS.SIGNALS_MANAGE) return effective.includes(PERMISSIONS.CONFIG_EDIT);
    return effective.includes(permission);
}
function plainScopes(value) { return value instanceof Map ? Object.fromEntries(value) : (value || {}); }
function defaultScope(user, permission) {
    if (user?.role === "admin") return SCOPES.ALL;
    if (!Array.isArray(user?.customPermissions) && ROLE_SCOPES[user?.role]?.[permission]) return ROLE_SCOPES[user.role][permission];
    const allowed = PERMISSION_DEFINITIONS[permission]?.allowedScopes || [];
    return allowed.includes(SCOPES.ASSIGNED) ? SCOPES.ASSIGNED : allowed.includes(SCOPES.OWN) ? SCOPES.OWN : SCOPES.ALL;
}
function scopeForPermission(user, permission) {
    if (!hasPermission(user, permission)) return null;
    const allowed = PERMISSION_DEFINITIONS[permission]?.allowedScopes || [];
    const selected = plainScopes(user.permissionScopes)[permission];
    return allowed.includes(selected) ? selected : defaultScope(user, permission);
}
function resourceIdentity(resource) {
    if (resource && typeof resource === "object") return { username: resource.username, ownerUserId: resource.ownerUserId ? String(resource.ownerUserId) : null, visibility: resource.visibility || "public" };
    return { username: resource, ownerUserId: null, visibility: "public" };
}
function canAccessResource(user, permission, resource) {
    const scope = scopeForPermission(user, permission);
    const { username, ownerUserId, visibility } = resourceIdentity(resource);
    const own = !!username && (ownerUserId === String(user?.id || "") || (!ownerUserId && [user?.username, user?.email].filter(Boolean).includes(String(username))));
    const assigned = !!username && (user?.botUsernames || []).includes(username);
    if (visibility === "private" && user?.role !== "admin" && !own && !assigned) return false;
    if (scope === SCOPES.ALL) return true;
    if (scope === SCOPES.ASSIGNED) return assigned;
    if (scope === SCOPES.OWN) return own;
    if (scope === SCOPES.OWN_ASSIGNED) return own || assigned;
    return false;
}
function normalizePermissionScopes(value, permissions) {
    const input = plainScopes(value); const result = {};
    for (const permission of permissions || []) {
        const allowed = PERMISSION_DEFINITIONS[permission]?.allowedScopes || [];
        if (input[permission] != null && !allowed.includes(input[permission])) throw new Error(`Scope không hợp lệ cho ${permission}`);
        if (input[permission]) result[permission] = input[permission];
    }
    return result;
}
module.exports = { SCOPES, PERMISSIONS, PERMISSION_DEFINITIONS, PERMISSION_LABELS, ROLE_PERMISSIONS, ROLE_SCOPES, ROLE_LABELS, ROLES, permissionsForRole, permissionsForUser, isPermission, hasPermission, scopeForPermission, canAccessResource, normalizePermissionScopes, plainScopes };
