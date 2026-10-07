function pagination(query = {}, defaults = {}) {
    const defaultLimit = defaults.limit || 50;
    const maxLimit = defaults.max || 100;
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(10, Number.parseInt(query.limit, 10) || defaultLimit));
    return { page, limit, skip: (page - 1) * limit };
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { pagination, escapeRegex };
