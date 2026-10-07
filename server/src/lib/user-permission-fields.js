const ACCESS_ASSIGNMENT_FIELDS = Object.freeze([
    "role",
    "botUsernames",
    "customPermissions",
    "permissionScopes",
]);

function hasAccessAssignmentFields(body) {
    if (!body || typeof body !== "object") return false;
    return ACCESS_ASSIGNMENT_FIELDS.some((field) =>
        Object.prototype.hasOwnProperty.call(body, field)
    );
}

module.exports = { ACCESS_ASSIGNMENT_FIELDS, hasAccessAssignmentFields };
