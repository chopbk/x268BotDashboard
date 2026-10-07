const PERMISSIONS = Object.freeze({
    USERS_MANAGE: "users.manage",
    BOTS_VIEW: "bots.view",
    BOTS_OPERATE: "bots.operate",
    CONFIG_VIEW: "config.view",
    CONFIG_EDIT: "config.edit",
    POSITIONS_VIEW: "positions.view",
    POSITIONS_OPEN: "positions.open",
    POSITIONS_CLOSE: "positions.close",
    SIGNALS_VIEW: "signals.view",
    SIGNALS_MANAGE: "signals.manage",
    LOGS_VIEW: "logs.view",
    CREDENTIALS_VIEW: "credentials.view",
    CREDENTIALS_MANAGE: "credentials.manage",
});

const PERMISSION_LABELS = Object.freeze({
    [PERMISSIONS.USERS_MANAGE]: "Quản lý người dùng",
    [PERMISSIONS.BOTS_VIEW]: "Xem bot",
    [PERMISSIONS.BOTS_OPERATE]: "Vận hành bot",
    [PERMISSIONS.CONFIG_VIEW]: "Xem cấu hình",
    [PERMISSIONS.CONFIG_EDIT]: "Sửa cấu hình",
    [PERMISSIONS.POSITIONS_VIEW]: "Xem position",
    [PERMISSIONS.POSITIONS_OPEN]: "Mở position",
    [PERMISSIONS.POSITIONS_CLOSE]: "Đóng position",
    [PERMISSIONS.SIGNALS_VIEW]: "Xem signal",
    [PERMISSIONS.SIGNALS_MANAGE]: "Quản lý signal",
    [PERMISSIONS.LOGS_VIEW]: "Xem log",
    [PERMISSIONS.CREDENTIALS_VIEW]: "Xem API/credential",
    [PERMISSIONS.CREDENTIALS_MANAGE]: "Sửa API/credential",
});

const VIEWER_PERMISSIONS = [
    PERMISSIONS.BOTS_VIEW,
    PERMISSIONS.CONFIG_VIEW,
    PERMISSIONS.POSITIONS_VIEW,
    PERMISSIONS.SIGNALS_VIEW,
];

const OPERATOR_PERMISSIONS = [
    ...VIEWER_PERMISSIONS,
    PERMISSIONS.BOTS_OPERATE,
    PERMISSIONS.CONFIG_EDIT,
    PERMISSIONS.POSITIONS_OPEN,
    PERMISSIONS.POSITIONS_CLOSE,
    PERMISSIONS.SIGNALS_MANAGE,
    PERMISSIONS.LOGS_VIEW,
];

const ROLE_PERMISSIONS = Object.freeze({
    admin: Object.freeze([
        ...OPERATOR_PERMISSIONS,
        PERMISSIONS.USERS_MANAGE,
        PERMISSIONS.CREDENTIALS_VIEW,
        PERMISSIONS.CREDENTIALS_MANAGE,
    ]),
    operator: Object.freeze(OPERATOR_PERMISSIONS),
    viewer: Object.freeze(VIEWER_PERMISSIONS),
    // Tài khoản đã tạo trước khi có RBAC tiếp tục hoạt động như viewer.
    user: Object.freeze(VIEWER_PERMISSIONS),
    pending: Object.freeze([]),
});

const ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));

function permissionsForRole(role) {
    return ROLE_PERMISSIONS[role] || [];
}

function isPermission(permission) {
    return Object.values(PERMISSIONS).includes(permission);
}

function permissionsForUser(user) {
    if (!user) return [];
    if (user.role === "pending") return [];
    if (user.role === "admin") return permissionsForRole("admin");
    if (!Array.isArray(user.customPermissions)) return permissionsForRole(user.role);
    return [...new Set(user.customPermissions.filter(isPermission))];
}

function hasPermission(user, permission) {
    return permissionsForUser(user).includes(permission);
}

module.exports = {
    PERMISSIONS,
    PERMISSION_LABELS,
    ROLE_PERMISSIONS,
    ROLES,
    permissionsForRole,
    permissionsForUser,
    isPermission,
    hasPermission,
};
