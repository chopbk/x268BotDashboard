const UserApi = require("../models/user-api");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { httpError } = require("./http");
const { normalizeName } = require("./bot-directory");

const EXCHANGES = Object.freeze([
    "binance",
    "kucoin",
    "huobi",
    "okex",
    "bybit",
    "bitget",
    "bybitv5",
    "bingx",
    "aster",
    "spot",
]);

const SECRET_MAX = 512;
const PASSPHRASE_MAX = 128;
const SUB_ACCOUNT_MAX = 64;

function assertName(name) {
    if (!name || name.length > 64 || /\s/.test(name) || name.includes("/")) {
        throw httpError(400, "Username không hợp lệ");
    }
}

function canSeeAll(user) {
    return hasPermission(user, PERMISSIONS.USERS_MANAGE);
}

function canAccessApi(user, username) {
    if (!user || !username) return false;
    if (canSeeAll(user)) return true;
    return (user.botUsernames || []).includes(username);
}

function assertAccess(user, username) {
    if (!canAccessApi(user, username)) {
        throw httpError(403, "Không có quyền với User API này");
    }
}

function hasTextExpr(field) {
    return {
        $gt: [
            {
                $strLenCP: {
                    $convert: { input: `$${field}`, to: "string", onError: "", onNull: "" },
                },
            },
            0,
        ],
    };
}

const PUBLIC_PROJECT = Object.freeze({
    _id: 0,
    username: 1,
    exchange: { $ifNull: ["$exchange", ""] },
    hedgeMode: { $ifNull: ["$hedge_mode", true] },
    test: { $ifNull: ["$test", false] },
    subAccount: { $ifNull: ["$sub_account", ""] },
    hasApiKey: hasTextExpr("api_key"),
    hasApiSecret: hasTextExpr("api_secret"),
    hasPassword: hasTextExpr("password"),
    updatedAt: { $ifNull: ["$updatedAt", null] },
});

function toPublicApi(doc) {
    const hedgeMode =
        typeof doc.hedgeMode === "boolean"
            ? doc.hedgeMode
            : typeof doc.hedge_mode === "boolean"
              ? doc.hedge_mode
              : true;
    return {
        username: doc.username,
        exchange: doc.exchange || "",
        hedgeMode,
        test: !!doc.test,
        subAccount: doc.subAccount ?? doc.sub_account ?? "",
        hasApiKey: doc.hasApiKey != null ? !!doc.hasApiKey : !!doc.api_key,
        hasApiSecret: doc.hasApiSecret != null ? !!doc.hasApiSecret : !!doc.api_secret,
        hasPassword: doc.hasPassword != null ? !!doc.hasPassword : !!doc.password,
        updatedAt: doc.updatedAt || null,
    };
}

function scopeFilter(user) {
    if (canSeeAll(user)) return {};
    return { username: { $in: user?.botUsernames || [] } };
}

function own(body, camel, snake) {
    if (!body || typeof body !== "object") return false;
    return Object.prototype.hasOwnProperty.call(body, camel) || Object.prototype.hasOwnProperty.call(body, snake);
}

function readField(body, camel, snake) {
    if (!body || typeof body !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(body, camel)) return body[camel];
    if (Object.prototype.hasOwnProperty.call(body, snake)) return body[snake];
    return undefined;
}

function readString(value, label, max) {
    if (value == null) return "";
    if (typeof value !== "string") throw httpError(400, `${label} không hợp lệ`);
    const text = value.trim();
    if (text.length > max) throw httpError(400, `${label} quá dài`);
    return text;
}

function readExchange(value, required) {
    if (value == null || value === "") {
        if (required) throw httpError(400, "Sàn không hợp lệ");
        return undefined;
    }
    if (typeof value !== "string") throw httpError(400, "Sàn không hợp lệ");
    const exchange = value.trim().toLowerCase();
    if (!EXCHANGES.includes(exchange)) throw httpError(400, "Sàn không hợp lệ");
    return exchange;
}

function readBool(value, label) {
    if (typeof value !== "boolean") throw httpError(400, `${label} không hợp lệ`);
    return value;
}

function secretValue(body, camel, snake, label, max, required) {
    if (!own(body, camel, snake)) {
        if (required) throw httpError(400, `${label} là bắt buộc`);
        return undefined;
    }
    const text = readString(readField(body, camel, snake), label, max);
    if (!text) {
        if (required) throw httpError(400, `${label} là bắt buộc`);
        return undefined;
    }
    return text;
}

async function findPublic(username) {
    const rows = await UserApi.aggregate([
        { $match: { username } },
        { $project: PUBLIC_PROJECT },
        { $limit: 1 },
    ]);
    return rows[0] ? toPublicApi(rows[0]) : null;
}

async function listUserApis(actor) {
    const rows = await UserApi.aggregate([
        { $match: scopeFilter(actor) },
        { $project: PUBLIC_PROJECT },
        { $sort: { username: 1 } },
    ]);
    return rows.filter((row) => canAccessApi(actor, row.username)).map(toPublicApi);
}

async function getUserApi(actor, username) {
    assertName(username);
    assertAccess(actor, username);
    const row = await findPublic(username);
    if (!row) throw httpError(404, "Không tìm thấy User API");
    return row;
}

async function createUserApi(actor, body) {
    const input = body || {};
    const username = normalizeName(input.username);
    assertName(username);
    assertAccess(actor, username);

    const exchange = readExchange(input.exchange, true);
    const apiKey = secretValue(input, "apiKey", "api_key", "API key", SECRET_MAX, true);
    const apiSecret = secretValue(input, "apiSecret", "api_secret", "API secret", SECRET_MAX, true);
    const passphrase = secretValue(input, "password", "password", "Passphrase", PASSPHRASE_MAX, false);
    const subAccount = readString(readField(input, "subAccount", "sub_account"), "Sub account", SUB_ACCOUNT_MAX);
    const hedgeMode = own(input, "hedgeMode", "hedge_mode")
        ? readBool(readField(input, "hedgeMode", "hedge_mode"), "Hedge mode")
        : true;
    const test = own(input, "test", "test") ? readBool(input.test, "Test") : false;

    const existing = await UserApi.findOne({ username }).select("username").lean();
    if (existing) throw httpError(409, "User API đã tồn tại");

    const doc = {
        username,
        exchange,
        api_key: apiKey,
        api_secret: apiSecret,
        hedge_mode: hedgeMode,
        test,
        sub_account: subAccount,
    };
    if (passphrase) doc.password = passphrase;

    try {
        await UserApi.create(doc);
    } catch (error) {
        if (error?.code === 11000) throw httpError(409, "User API đã tồn tại");
        throw error;
    }
    return getUserApi(actor, username);
}

async function updateUserApi(actor, username, body) {
    assertName(username);
    assertAccess(actor, username);
    const input = body || {};
    const current = await UserApi.findOne({ username }).select("username").lean();
    if (!current) throw httpError(404, "Không tìm thấy User API");

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(input, "username")) {
        const nextName = normalizeName(input.username);
        assertName(nextName);
        if (nextName !== username) {
            assertAccess(actor, nextName);
            const taken = await UserApi.findOne({ username: nextName }).select("username").lean();
            if (taken) throw httpError(409, "User API đã tồn tại");
            patch.username = nextName;
        }
    }
    if (Object.prototype.hasOwnProperty.call(input, "exchange")) {
        patch.exchange = readExchange(input.exchange, true);
    }
    if (own(input, "hedgeMode", "hedge_mode")) {
        patch.hedge_mode = readBool(readField(input, "hedgeMode", "hedge_mode"), "Hedge mode");
    }
    if (Object.prototype.hasOwnProperty.call(input, "test")) {
        patch.test = readBool(input.test, "Test");
    }
    if (own(input, "subAccount", "sub_account")) {
        patch.sub_account = readString(readField(input, "subAccount", "sub_account"), "Sub account", SUB_ACCOUNT_MAX);
    }

    const apiKey = secretValue(input, "apiKey", "api_key", "API key", SECRET_MAX, false);
    const apiSecret = secretValue(input, "apiSecret", "api_secret", "API secret", SECRET_MAX, false);
    const passphrase = secretValue(input, "password", "password", "Passphrase", PASSPHRASE_MAX, false);
    if (apiKey) patch.api_key = apiKey;
    if (apiSecret) patch.api_secret = apiSecret;
    if (passphrase) patch.password = passphrase;

    if (Object.keys(patch).length) {
        try {
            await UserApi.updateOne({ username }, { $set: patch });
        } catch (error) {
            if (error?.code === 11000) throw httpError(409, "User API đã tồn tại");
            throw error;
        }
    }
    return getUserApi(actor, patch.username || username);
}

async function deleteUserApi(actor, username) {
    assertName(username);
    assertAccess(actor, username);
    const current = await UserApi.findOne({ username }).select("username").lean();
    if (!current) throw httpError(404, "Không tìm thấy User API");
    await UserApi.deleteOne({ username });
    return { ok: true };
}

module.exports = {
    EXCHANGES,
    PUBLIC_PROJECT,
    toPublicApi,
    listUserApis,
    getUserApi,
    createUserApi,
    updateUserApi,
    deleteUserApi,
    listApis: listUserApis,
    getApi: getUserApi,
    createApi: createUserApi,
    updateApi: updateUserApi,
    deleteApi: deleteUserApi,
};
