const AccountConfig = require("../models/account-config");
const { PERMISSIONS } = require("../auth/access-control");
const { httpError } = require("./http");
const { requireBot } = require("./bot-directory");

const MODES = Object.freeze(["FIX", "RATIO", "RISK", "RR", "LOSS"]);

function flag(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toSummary(doc) {
    const trade = doc.trade_config || {};
    const mode = String(trade.MARGIN?.MODE || "FIX").toUpperCase();
    const cost = num(trade.FIX_COST_AMOUNT);
    const leverage = num(trade.LONG_LEVERAGE);
    return {
        env: doc.env,
        missing: false,
        on: flag(trade.ON, true),
        long: flag(trade.LONG, true),
        short: flag(trade.SHORT, false),
        signals: Array.isArray(doc.signals) ? doc.signals : [],
        mode,
        cost,
        leverage,
        ratio: num(trade.MARGIN?.RATIO),
        fixloss: num(trade.MARGIN?.FIXLOSS),
        risk: num(trade.OPEN?.RISK),
        volume: cost != null && leverage != null ? cost * leverage : null,
    };
}

function missingSummary(env) {
    return {
        env,
        missing: true,
        on: null,
        long: null,
        short: null,
        signals: [],
        mode: null,
        cost: null,
        leverage: null,
        ratio: null,
        fixloss: null,
        risk: null,
        volume: null,
    };
}

async function loadDocs(envs) {
    if (!envs.length) return [];
    return AccountConfig.find({ env: { $in: envs } })
        .select("env signals trade_config")
        .lean();
}

async function listConfigSummaries(actor, username) {
    const bot = await requireBot(actor, username, PERMISSIONS.CONFIG_VIEW);
    const envs = bot.accounts || [];
    const docs = await loadDocs(envs);
    const byEnv = new Map(docs.map((doc) => [doc.env, doc]));
    return envs.map((env) => {
        const doc = byEnv.get(env);
        return doc ? toSummary(doc) : missingSummary(env);
    });
}

async function getConfigSummary(actor, username, env, permission = PERMISSIONS.CONFIG_VIEW) {
    const bot = await requireBot(actor, username, permission);
    if (!(bot.accounts || []).includes(env)) throw httpError(404, "Không tìm thấy config");
    const doc = await AccountConfig.findOne({ env }).select("env signals trade_config").lean();
    if (!doc) throw httpError(404, "Không tìm thấy config");
    return toSummary(doc);
}

function readBool(value, label) {
    if (typeof value !== "boolean") throw httpError(400, `${label} không hợp lệ`);
    return value;
}

function readNumber(value, label, { min, max }) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || (max != null && n > max)) {
        throw httpError(400, `${label} không hợp lệ`);
    }
    return n;
}

function readSignals(value) {
    if (!Array.isArray(value)) throw httpError(400, "Signal không hợp lệ");
    const seen = new Set();
    const signals = [];
    for (const item of value) {
        if (typeof item !== "string") throw httpError(400, "Signal không hợp lệ");
        const name = item.trim();
        if (!name) continue;
        if (name.length > 32 || /\s/.test(name) || name.includes("/") || !/^[A-Za-z0-9_-]+$/.test(name)) {
            throw httpError(400, "Signal không hợp lệ");
        }
        if (seen.has(name)) continue;
        seen.add(name);
        signals.push(name);
    }
    if (signals.length > 40) throw httpError(400, "Quá nhiều signal");
    return signals;
}

async function updateConfigSummary(actor, username, env, body) {
    const bot = await requireBot(actor, username, PERMISSIONS.CONFIG_EDIT);
    if (!(bot.accounts || []).includes(env)) throw httpError(404, "Không tìm thấy config");
    const input = body || {};
    const current = await AccountConfig.findOne({ env }).select("env signals trade_config").lean();
    if (!current) throw httpError(404, "Không tìm thấy config");
    if (!current.trade_config || typeof current.trade_config !== "object") {
        throw httpError(400, "Config chưa có trade_config");
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(input, "on")) {
        patch["trade_config.ON"] = readBool(input.on, "On");
    }
    if (Object.prototype.hasOwnProperty.call(input, "long")) {
        patch["trade_config.LONG"] = readBool(input.long, "Long");
    }
    if (Object.prototype.hasOwnProperty.call(input, "short")) {
        patch["trade_config.SHORT"] = readBool(input.short, "Short");
    }
    if (Object.prototype.hasOwnProperty.call(input, "mode")) {
        const mode = String(input.mode || "").trim().toUpperCase();
        if (!MODES.includes(mode)) throw httpError(400, "Mode không hợp lệ");
        patch["trade_config.MARGIN.MODE"] = mode;
    }
    if (Object.prototype.hasOwnProperty.call(input, "cost")) {
        patch["trade_config.FIX_COST_AMOUNT"] = readNumber(input.cost, "Cost", { min: 0, max: 100000000 });
    }
    if (Object.prototype.hasOwnProperty.call(input, "leverage")) {
        patch["trade_config.LONG_LEVERAGE"] = readNumber(input.leverage, "Đòn bẩy", { min: 1, max: 125 });
    }
    if (Object.prototype.hasOwnProperty.call(input, "ratio")) {
        patch["trade_config.MARGIN.RATIO"] = readNumber(input.ratio, "Ratio", { min: 0, max: 1000 });
    }
    if (Object.prototype.hasOwnProperty.call(input, "fixloss")) {
        patch["trade_config.MARGIN.FIXLOSS"] = readNumber(input.fixloss, "Fix loss", { min: 0, max: 100000000 });
    }
    if (Object.prototype.hasOwnProperty.call(input, "risk")) {
        patch["trade_config.OPEN.RISK"] = readNumber(input.risk, "Risk", { min: 0, max: 1000 });
    }

    const signals = Object.prototype.hasOwnProperty.call(input, "signals") ? readSignals(input.signals) : null;
    if (!Object.keys(patch).length && !signals) throw httpError(400, "Không có gì để sửa");

    const update = {};
    if (Object.keys(patch).length) update.$set = patch;
    if (signals) {
        update.$set = { ...(update.$set || {}), signals };
    }
    await AccountConfig.updateOne({ env }, update);
    return getConfigSummary(actor, username, env, PERMISSIONS.CONFIG_EDIT);
}

module.exports = {
    MODES,
    toSummary,
    listConfigSummaries,
    getConfigSummary,
    updateConfigSummary,
};
