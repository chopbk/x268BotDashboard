/**
 * Normalize lỗi sàn thành nhóm ổn định cho API/receipt.
 * Không đính kèm secret, signature, passphrase hay signed payload.
 */

const { httpError } = require("../http");

const CATEGORIES = Object.freeze({
    credential: "credential",
    permission: "permission",
    rate_limit: "rate_limit",
    network: "network",
    timeout: "timeout",
    instrument: "instrument",
    validation: "validation",
    insufficient_margin: "insufficient_margin",
    exchange_rejected: "exchange_rejected",
    unknown_result: "unknown_result",
    unsupported: "unsupported",
});

const STATUS_BY_CATEGORY = Object.freeze({
    credential: 400,
    permission: 403,
    rate_limit: 429,
    network: 502,
    timeout: 504,
    instrument: 400,
    validation: 400,
    insufficient_margin: 400,
    exchange_rejected: 400,
    unknown_result: 502,
    unsupported: 400,
});

function exchangeError(category, message, extra = {}) {
    const cat = CATEGORIES[category] || CATEGORIES.unknown_result;
    const status = extra.status || STATUS_BY_CATEGORY[cat] || 400;
    const error = httpError(status, message || cat, {
        category: cat,
        exchange: extra.exchange || null,
        code: extra.code != null ? String(extra.code) : null,
        retryAfterMs: extra.retryAfterMs || null,
    });
    return error;
}

function unsupportedAction(exchange, action) {
    return exchangeError("unsupported", `${exchange || "Sàn"} chưa hỗ trợ ${action} trên web`, {
        exchange,
        code: "capability_false",
    });
}

function classifyHttpStatus(status, bodyMsg = "") {
    const msg = String(bodyMsg || "").toLowerCase();
    if (status === 418 || status === 429) return CATEGORIES.rate_limit;
    if (status === 401) return CATEGORIES.credential;
    if (status === 403) return CATEGORIES.permission;
    if (status === 408 || status === 504) return CATEGORIES.timeout;
    if (/insufficient|margin|balance|not enough/.test(msg)) return CATEGORIES.insufficient_margin;
    if (/symbol|instrument|instid|contract/.test(msg)) return CATEGORIES.instrument;
    if (status >= 400 && status < 500) return CATEGORIES.exchange_rejected;
    if (status >= 500) return CATEGORIES.network;
    return CATEGORIES.unknown_result;
}

function fromFetchFailure(error, exchange) {
    if (error?.category) return error;
    if (error?.name === "AbortError") {
        return exchangeError("timeout", "Sàn không phản hồi", { exchange });
    }
    if (error?.status) {
        const category = classifyHttpStatus(error.status, error.message);
        return exchangeError(category, error.message || category, {
            exchange,
            status: error.status,
            code: error.code,
            retryAfterMs: error.retryAfterMs,
        });
    }
    return exchangeError("network", error?.message || "Không kết nối được sàn", { exchange });
}

function sanitizeErrorMessage(message) {
    return String(message || "")
        .replace(/signature[=:]\s*\S+/gi, "signature=[redacted]")
        .replace(/api[_-]?key[=:]\s*\S+/gi, "apiKey=[redacted]")
        .replace(/passphrase[=:]\s*\S+/gi, "passphrase=[redacted]")
        .replace(/secret[=:]\s*\S+/gi, "secret=[redacted]")
        .slice(0, 400);
}

module.exports = {
    CATEGORIES,
    exchangeError,
    unsupportedAction,
    classifyHttpStatus,
    fromFetchFailure,
    sanitizeErrorMessage,
};
