/**
 * Allowlist env keys được remote admin quản lý qua bot_profile.
 * Client/web không được gửi key ngoài registry.
 */

/** Bootstrap — không clear, không ghi từ profile, không sửa qua web */
const BOOTSTRAP_KEYS = new Set([
    "MONGODB",
    "MONGO_URI",
    "BOT_ENV",
    "BOT_CONTROL_HOST_ID",
    "BOT_CONTROL_ALLOWLIST_PATH",
    "BOT_CONTROL_AGENT_ID",
    "BOT_CONTROL_CREDENTIAL",
]);

/** Forbidden luôn — kể cả khi lọt registry nhầm */
const FORBIDDEN_PATTERN = /(key|secret|password|token|uri|mongodb|redis|proxy)/i;

const FORBIDDEN_EXACT = new Set([
    "MONGODB",
    "MONGO_URI",
    "BOT_ENV",
    "BOT_PROFILE_FORCE",
    "USE_LEGACY_ENV",
    "BOT_CONTROL_HOST_ID",
    "BOT_CONTROL_ALLOWLIST_PATH",
    "BOT_CONTROL_AGENT_ID",
    "BOT_CONTROL_CREDENTIAL",
    "PATH",
    "HOME",
    "NODE_OPTIONS",
    "name",
    "pm_id",
    "PWD",
    "SHELL",
    "USER",
    "LOGNAME",
]);

/**
 * falseMode:
 * - unset: tắt = xóa key (role flags / truthy checks)
 * - false_string: cho phép "false" khi caller đọc explicit
 */
const ROLE_KEYS = new Set([
    "TRADER",
    "MONITOR",
    "LISTENER",
    "SIGNAL",
    "POSTER",
    "AI_SUMMARY",
    "DCA_MTF_BOT",
    "SERVER",
    "TRADINGVIEW_WEBHOOK",
    "WEBHOOK",
]);

const TOP_VOLUME_KEYS = [
    "TOP_VOLUME_RR_STRICT",
    "TOP_VOLUME_RR_ALT",
    "TOP_VOLUME_SCAN_LIMIT",
    "TOP_VOLUME_CANDLE_LIMIT",
    "TOP_VOLUME_TELEGRAM_TOP",
    "TOP_VOLUME_MIN_SCORE",
    "TOP_VOLUME_MIN_RR",
    "TOP_VOLUME_ALT_4H_TREND",
    "TOP_VOLUME_ALT_MIN_4H_CANDLES",
    "TOP_VOLUME_AI_COMMENT",
    "TOP_VOLUME_AI_SCAN",
    "TOP_VOLUME_OI_INTERNALS_BATCH",
    "TOP_VOLUME_OI_INTERNALS_LIMIT",
];

const UNIVERSE_KEYS = [
    "UNIVERSE_FILTER_ENABLED",
    "UNIVERSE_MIN_QUOTE_VOLUME",
    "UNIVERSE_MIN_TRADE_COUNT",
    "UNIVERSE_MIN_ONBOARD_DAYS",
    "UNIVERSE_TICKER_LIMIT",
    "UNIVERSE_SCAN_LIMIT",
    "UNIVERSE_FETCH_DELAY_MS",
    "UNIVERSE_MAX_NEW_PER_CYCLE",
    "UNIVERSE_CANDLE_LIMIT",
];

/** @type {Record<string, { type: string, roles?: string[], risk: string, secret?: boolean, falseMode?: string, ref?: string, help?: string }>} */
const REGISTRY = {};

function add(key, meta) {
    REGISTRY[key] = {
        type: meta.type || "string",
        roles: meta.roles || ["*"],
        risk: meta.risk || "low",
        secret: !!meta.secret,
        falseMode: meta.falseMode || null,
        ref: meta.ref || null,
        help: meta.help || "",
    };
}

function addRoleFlag(key, help) {
    add(key, {
        type: "role_flag",
        risk: "high",
        falseMode: "unset",
        help,
    });
}

// Nhận diện / role
add("NODE_ENV", { type: "string", risk: "high", help: "Env identity / Mongo lookup prefix" });
add("RUN", { type: "csv_usernames", risk: "high", help: "Danh sách username trader/monitor" });
addRoleFlag("TRADER", "Bật trader");
addRoleFlag("MONITOR", "Bật position monitor");
addRoleFlag("LISTENER", "Bật telegram/discord listener");
addRoleFlag("SIGNAL", "Bật signal scanner trong index");
addRoleFlag("POSTER", "Bật poster");
addRoleFlag("AI_SUMMARY", "Bật AI summary");
addRoleFlag("DCA_MTF_BOT", "Bật DCA/MTF bot");
addRoleFlag("SERVER", "Server mode flag");
addRoleFlag("TRADINGVIEW_WEBHOOK", "Bật TradingView webhook");
addRoleFlag("WEBHOOK", "Alias webhook");

// Kết nối config
add("MQTT", { type: "string", risk: "high", ref: "mqtt-config", help: "env trong mqtt-config" });
add("TELE", { type: "string", risk: "high", ref: "telegram-config", help: "env trong telegram-config" });
add("TELE_CLIENT", {
    type: "string",
    risk: "high",
    ref: "telegram-client",
    help: "env trong telegram-client",
});
add("TELE_CLIENT_VERSION", { type: "enum", risk: "medium", help: "1 | 2" });
add("DISCORD", { type: "string", risk: "medium", help: "Discord client env" });
add("UID_ENV", { type: "string", risk: "medium" });
add("HUB_SIGNAL", { type: "string", risk: "medium" });

// Luồng tín hiệu
add("PUBLISH_SIGNAL", { type: "bool_explicit", risk: "medium", falseMode: "false_string" });
add("PUBLISH_COMMAND", { type: "bool_explicit", risk: "medium", falseMode: "false_string" });
add("SCHEDULE_SIGNAL", { type: "role_flag", risk: "medium", falseMode: "unset" });
add("SAVE_SIGNAL", { type: "bool_explicit", risk: "low", falseMode: "false_string" });
add("SIGNAL_TRACE", { type: "bool_explicit", risk: "low", falseMode: "false_string" });
add("SIGNAL_TRACE_PAPER", { type: "bool_explicit", risk: "low", falseMode: "false_string" });

// Listener
[
    "GET_CHANNEL",
    "GET_INTERVAL",
    "FWDUID",
    "NUMFWD",
    "FORWARD_TO_CHANNEL",
    "ROSECHANNEL",
    "ROSECHAT",
    "X268CHANNEL",
    "X268VNCHANNEL",
    "X268CHAT",
    "CRISCHAT",
    "FORWARD_AI_REWRITE",
    "FORWARD_AI_REWRITE_TOPICS",
].forEach((k) => add(k, { type: "string", risk: "medium" }));
add("ROSE_VOLUME_DETECTOR", { type: "bool_explicit", risk: "medium", falseMode: "false_string" });

// Trader/monitor vận hành
add("MAX_VOLUME", { type: "number", risk: "high" });
add("MONITOR_ORDER", { type: "bool_explicit", risk: "medium", falseMode: "false_string" });
add("POST_POSITION", { type: "bool_explicit", risk: "low", falseMode: "false_string" });
add("PROFIT_DAILY_TELEGRAM_REPORT", {
    type: "bool_explicit",
    risk: "low",
    falseMode: "false_string",
});
add("LEVERAGE_SET_DELAY_MS", { type: "integer", risk: "low" });
add("LEVERAGE_USER_GAP_MS", { type: "integer", risk: "low" });
add("UPDATE_RISK_INTERVAL", { type: "integer", risk: "low" });
add("NUM_STATICS", { type: "integer", risk: "low" });

// Market / exchange
["MULTI", "BYBIT", "OKEX", "BITGET", "BINGX", "ASTER", "SPOT_BINANCE", "UPDATE_MARKET"].forEach((k) =>
    add(k, { type: "bool_explicit", risk: "medium", falseMode: "false_string" })
);
add("BLACKLIST_SYMBOLS", { type: "csv", risk: "medium" });
["NUM_OF_SYMBOLS", "NUM_OF_WS", "START_COIN", "END_COIN", "SYMBOL_START_INDEX"].forEach((k) =>
    add(k, { type: "integer", risk: "low" })
);

TOP_VOLUME_KEYS.forEach((k) => {
    const isBool = /AI_COMMENT$|AI_SCAN$|ALT_4H_TREND$/.test(k);
    add(k, {
        type: isBool ? "bool_explicit" : /RR|SCORE/.test(k) ? "number" : "integer",
        risk: "low",
        falseMode: isBool ? "false_string" : null,
    });
});
UNIVERSE_KEYS.forEach((k) => {
    const isBool = k === "UNIVERSE_FILTER_ENABLED";
    add(k, {
        type: isBool ? "bool_explicit" : "number",
        risk: "low",
        falseMode: isBool ? "false_string" : null,
    });
});

// Webhook / log
add("TRADINGVIEW_WEBHOOK_PORT", { type: "port", risk: "low" });
add("WEBHOOK_PORT", { type: "port", risk: "low" });
add("TRADINGVIEW_WEBHOOK_PATH", { type: "string", risk: "low" });
add("TRADINGVIEW_EMIT_NEW_MESS", { type: "bool_explicit", risk: "low", falseMode: "false_string" });
add("TRADINGVIEW_SIGNAL_NAME", { type: "string", risk: "low" });
add("LOG", { type: "string", risk: "low" });
add("LOGGER", { type: "string", risk: "low" });
add("DEBUG", { type: "role_flag", risk: "low", falseMode: "unset" });

// DCA paper helpers (non-secret)
add("DCA_MTF_PAPER", { type: "bool_explicit", risk: "medium", falseMode: "false_string" });
add("DCA_MTF_PAPER_BALANCE", { type: "number", risk: "low" });
add("DCA_MTF_ENV", { type: "string", risk: "medium" });
add("DCA_MTF_BREAKOUT_ENABLED", { type: "bool_explicit", risk: "low", falseMode: "false_string" });
add("DCA_MTF_ONCE", { type: "bool_explicit", risk: "low", falseMode: "false_string" });
add("PAPER", { type: "bool_explicit", risk: "high", falseMode: "false_string" });

function isForbiddenKey(key) {
    if (!key) return true;
    if (FORBIDDEN_EXACT.has(key)) return true;
    if (BOOTSTRAP_KEYS.has(key)) return true;
    if (key.startsWith("LD_")) return true;
    if (key.startsWith("pm_") || key.startsWith("PM2_")) return true;
    if (FORBIDDEN_PATTERN.test(key) && !REGISTRY[key]) return true;
    return false;
}

function getRegistryEntry(key) {
    return REGISTRY[key] || null;
}

function listRegistryEntries() {
    return Object.entries(REGISTRY).map(([key, meta]) => ({ key, ...meta }));
}

function getManagedKeys() {
    return Object.keys(REGISTRY);
}

function isManagedKey(key) {
    return Object.prototype.hasOwnProperty.call(REGISTRY, key);
}

function isRoleKey(key) {
    return ROLE_KEYS.has(key) || (REGISTRY[key] && REGISTRY[key].falseMode === "unset");
}

/**
 * Chuẩn hóa giá trị trước khi ghi profile / apply env.
 * Role flags: chỉ "true" hoặc null (xóa).
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
function normalizeManagedValue(key, raw) {
    if (isForbiddenKey(key) || !isManagedKey(key)) {
        return { ok: false, error: `Key không được phép: ${key}` };
    }
    const meta = REGISTRY[key];
    if (raw == null || raw === "") {
        return { ok: true, value: null };
    }

    let value = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw).trim();

    if (meta.type === "role_flag" || meta.falseMode === "unset") {
        const on = ["true", "1", "yes"].includes(value.toLowerCase());
        const off = ["false", "0", "no"].includes(value.toLowerCase());
        if (off || value === "") return { ok: true, value: null };
        if (!on) return { ok: false, error: `${key} phải là true hoặc tắt (unset)` };
        return { ok: true, value: "true" };
    }

    if (meta.type === "bool_explicit" || meta.falseMode === "false_string") {
        const low = value.toLowerCase();
        if (["true", "1", "yes"].includes(low)) return { ok: true, value: "true" };
        if (["false", "0", "no"].includes(low)) return { ok: true, value: "false" };
        return { ok: false, error: `${key} phải là true|false` };
    }

    if (meta.type === "enum" && key === "TELE_CLIENT_VERSION") {
        if (value !== "1" && value !== "2") {
            return { ok: false, error: "TELE_CLIENT_VERSION chỉ 1 hoặc 2" };
        }
        return { ok: true, value };
    }

    if (meta.type === "integer" || meta.type === "port") {
        if (!/^-?\d+$/.test(value)) return { ok: false, error: `${key} phải là integer` };
        if (meta.type === "port") {
            const n = Number(value);
            if (n < 1 || n > 65535) return { ok: false, error: `${key} port 1-65535` };
        }
        return { ok: true, value };
    }

    if (meta.type === "number") {
        if (!Number.isFinite(Number(value))) return { ok: false, error: `${key} phải là number` };
        return { ok: true, value };
    }

    return { ok: true, value };
}

/**
 * Apply một map variables đã validate vào object env (mutate).
 * Clear managed keys trước; bootstrap không đụng.
 */
function applyDesiredStateToEnv(envObj, variables, { clearManaged = true } = {}) {
    const applied = [];
    const cleared = [];

    if (clearManaged) {
        for (const key of getManagedKeys()) {
            if (BOOTSTRAP_KEYS.has(key)) continue;
            if (Object.prototype.hasOwnProperty.call(envObj, key)) {
                delete envObj[key];
                cleared.push(key);
            }
        }
    }

    const vars = variables && typeof variables === "object" ? variables : {};
    for (const [rawKey, rawVal] of Object.entries(vars)) {
        const key = String(rawKey).trim();
        if (!key || BOOTSTRAP_KEYS.has(key) || isForbiddenKey(key)) continue;
        if (!isManagedKey(key)) continue;

        const norm = normalizeManagedValue(key, rawVal);
        if (!norm.ok) continue;
        if (norm.value == null) {
            delete envObj[key];
            cleared.push(key);
            continue;
        }
        envObj[key] = norm.value;
        applied.push(key);
    }

    return { applied, cleared };
}

module.exports = {
    BOOTSTRAP_KEYS,
    FORBIDDEN_PATTERN,
    FORBIDDEN_EXACT,
    ROLE_KEYS,
    REGISTRY,
    TOP_VOLUME_KEYS,
    UNIVERSE_KEYS,
    isForbiddenKey,
    getRegistryEntry,
    listRegistryEntries,
    getManagedKeys,
    isManagedKey,
    isRoleKey,
    normalizeManagedValue,
    applyDesiredStateToEnv,
};
