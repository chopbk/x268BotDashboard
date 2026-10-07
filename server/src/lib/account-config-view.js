const AccountConfig = require("../models/account-config");
const { PERMISSIONS } = require("../auth/access-control");
const { httpError } = require("./http");
const { requireBot } = require("./bot-directory");

const MODES = Object.freeze(["FIX", "RATIO", "RISK", "RR", "LOSS"]);
const OPEN_TYPES = Object.freeze(["MARKET", "LIMIT", "STOPMARKET", "STOPLIMIT", "FOLLOWSIGNAL"]);
const SL_TYPES = Object.freeze([
    "MARKET",
    "LIMIT",
    "CANDLE",
    "EMA",
    "ATR",
    "FOLLOWSIGNAL",
    "HYBRID",
    "ENTRY_STYLE",
    "ROSE",
]);
const CANDLES = Object.freeze(["1M", "5M", "15M", "30M", "1H", "4H", "12H", "1D"]);
const TP_TYPES = Object.freeze(["FIX", "TRAILING", "FOLLOWSIGNAL", "STOPLOSS", "HYBRID", "ENTRY_STYLE", "ROSE", "ATR"]);
const TRAILING_TYPES = Object.freeze(["FIX", "STOPLOSS", "TP1", "TP2", "TP3", "TP4", "ATR", "ROSE"]);
const SYMBOL_TYPES = Object.freeze(["MEGA", "BLUECHIP", "LARGE", "MIDCAP", "SMALLCAP", "MICRO", "SHIT", "UNKNOWN"]);
const FILTERS = Object.freeze(["EMA15_REVERSE", "EMA15", "BLUECHIP", "BLUE", "BLOWOFF", "BLOW", "FOMO", "MEGA_BTC15"]);
const SYNC_GROUPS = Object.freeze([
    "cost",
    "level",
    "sl",
    "tp",
    "trailing",
    "hp",
    "open",
    "margin",
    "copy",
    "on",
    "paper",
    "signals",
    "blacklist",
    "interval",
]);

const AUDIT_FIELDS = Object.freeze([
    "on",
    "long",
    "short",
    "invert",
    "paper",
    "monitor",
    "wl",
    "autoConfig",
    "reportProfit",
    "signals",
    "blacklist",
    "whitelist",
    "mode",
    "cost",
    "leverage",
    "shortLeverage",
    "level",
    "ratio",
    "fixloss",
    "marginPeriod",
    "volume",
    "openType",
    "spread",
    "wait",
    "risk",
    "mark",
    "maxPosition",
    "symbolTypes",
    "symbolTypesDeny",
    "filterOn",
    "filters",
    "chasePct",
    "blowAtr",
    "fomoAtr",
    "tpType",
    "tpPercent",
    "tpClose",
    "tpTime",
    "tpHold",
    "slType",
    "slCandle",
    "slPeriod",
    "sl",
    "sli",
    "sl2",
    "slTime",
    "maxLoss",
    "slPosition",
    "trailing",
    "trailingType",
    "sp",
    "trigger",
    "r",
    "hp",
    "hpTrigger",
    "rhsl",
    "rh",
    "copy",
    "copyFix",
    "copyDca",
    "copyFollow",
    "maxVolume",
    "copyRate",
    "interval",
    "syncFrom",
    "syncExcept",
    "syncScale",
    "syncMarginRatio",
    "syncWalletBal",
]);

function has(body, key) {
    return Object.prototype.hasOwnProperty.call(body || {}, key);
}

function flag(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function upper(value) {
    return String(value ?? "").trim().toUpperCase();
}

function toSummary(doc) {
    const trade = doc.trade_config || {};
    const mode = upper(trade.MARGIN?.MODE || "FIX");
    const cost = num(trade.FIX_COST_AMOUNT);
    const leverage = num(trade.LONG_LEVERAGE);
    return {
        env: doc.env,
        missing: false,
        on: flag(trade.ON, true),
        long: flag(trade.LONG, true),
        short: flag(trade.SHORT, false),
        signals: list(doc.signals),
        mode,
        cost,
        leverage,
        ratio: num(trade.MARGIN?.RATIO),
        fixloss: num(trade.MARGIN?.FIXLOSS),
        risk: num(trade.OPEN?.RISK),
        volume: cost != null && leverage != null ? cost * leverage : null,
        openType: upper(trade.OPEN?.TYPE || "MARKET"),
    };
}

function toDetail(doc) {
    const trade = doc.trade_config || {};
    const open = trade.OPEN || {};
    const filters = open.FILTERS || {};
    const tp = trade.TP || {};
    const sl = trade.SL || {};
    const trailing = trade.TRAILING || {};
    const hp = trade.HP || {};
    const copy = trade.COPY || {};
    return {
        ...toSummary(doc),
        invert: flag(trade.INVERT, false),
        paper: flag(trade.PAPER, false),
        monitor: flag(trade.MONITOR, true),
        wl: flag(trade.WL, true),
        autoConfig: flag(trade.AUTO_CONFIG, false),
        reportProfit: flag(trade.REPORT_PROFIT, true),
        blacklist: list(doc.blacklist),
        whitelist: list(doc.whitelist),
        shortLeverage: num(trade.SHORT_LEVERAGE),
        level: num(trade.FIX_LEVERAGE),
        marginPeriod: num(trade.MARGIN?.PERIOD),
        openType: upper(open.TYPE || "MARKET"),
        spread: num(open.SPREAD),
        wait: num(open.WAIT),
        mark: num(open.MARK),
        maxPosition: num(open.MAX_POSITION),
        symbolTypes: list(open.SYMBOL_TYPES).map(upper),
        symbolTypesDeny: list(open.SYMBOL_TYPES_DENY).map(upper),
        filterOn: flag(filters.ON, false),
        filters: list(filters.LIST).map(upper),
        chasePct: num(filters.CHASE_PCT),
        blowAtr: num(filters.BLOW_ATR),
        fomoAtr: num(filters.FOMO_ATR),
        tpType: upper(tp.TYPE || "FIX"),
        tpPercent: list(tp.PERCENT).map(num).filter((item) => item != null),
        tpClose: num(tp.CLOSE),
        tpTime: num(tp.TIME),
        tpHold: flag(tp.HOLD, false),
        slType: upper(sl.TYPE || "MARKET"),
        slCandle: upper(sl.SL_CANDLE || "5M"),
        slPeriod: num(sl.PERIOD),
        sl: num(sl.SL_PERCENT),
        sli: num(sl.SLI_PERCENT),
        sl2: num(sl.SL2_PERCENT),
        slTime: num(sl.SL_TIME),
        maxLoss: num(sl.MAX_LOSS),
        slPosition: flag(sl.POSITION, false),
        trailing: flag(trailing.ON, true),
        trailingType: upper(trailing.TYPE || "FIX"),
        sp: num(trailing.SP_PERCENT),
        trigger: num(trailing.TRIGGER_PERCENT),
        r: num(trailing.R_PERCENT),
        hp: flag(hp.ON, false),
        hpTrigger: num(hp.HP_PERCENT_TRIGGER),
        rhsl: num(hp.RHSL_PERCENT),
        rh: num(hp.RH_PERCENT),
        copy: flag(copy.ON, false),
        copyFix: flag(copy.FIX, false),
        copyDca: flag(copy.DCA, true),
        copyFollow: flag(copy.FOLLOW, true),
        maxVolume: num(copy.MAX_VOLUME),
        copyRate: num(copy.RATE),
        interval: num(trade.INTERVAL),
        syncFrom: doc.sync_from || "",
        syncExcept: list(doc.sync_except).map((item) => String(item).trim().toLowerCase()),
        syncScale: flag(doc.sync_scale, false),
        syncMarginRatio: num(doc.sync_margin_ratio),
        syncWalletBal: num(doc.sync_wallet_bal),
        slHybrid: sl.HYBRID && typeof sl.HYBRID === "object" ? sl.HYBRID : {},
        tpHybrid: tp.HYBRID && typeof tp.HYBRID === "object" ? tp.HYBRID : {},
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
        openType: null,
    };
}

async function loadDocs(envs) {
    if (!envs.length) return [];
    return AccountConfig.find({ env: { $in: envs } })
        .select("env signals blacklist whitelist trade_config sync_from sync_except sync_scale sync_margin_ratio sync_wallet_bal")
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

async function loadOwnedConfig(actor, username, env, permission) {
    const bot = await requireBot(actor, username, permission);
    if (!(bot.accounts || []).includes(env)) throw httpError(404, "Không tìm thấy config");
    const doc = await AccountConfig.findOne({ env })
        .select("env signals blacklist whitelist trade_config sync_from sync_except sync_scale sync_margin_ratio sync_wallet_bal")
        .lean();
    if (!doc) throw httpError(404, "Không tìm thấy config");
    return doc;
}

async function getConfigSummary(actor, username, env, permission = PERMISSIONS.CONFIG_VIEW) {
    const doc = await loadOwnedConfig(actor, username, env, permission);
    return toSummary(doc);
}

async function getConfigDetail(actor, username, env, permission = PERMISSIONS.CONFIG_VIEW) {
    const doc = await loadOwnedConfig(actor, username, env, permission);
    return toDetail(doc);
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

function readEnum(value, allowed, label, current) {
    const text = upper(value);
    const kept = upper(current);
    if (allowed.includes(text) || (text && text === kept)) return text;
    throw httpError(400, `${label} không hợp lệ`);
}

function readTokenList(value, label, { allowed, lower = false, itemMax = 32, max = 80 } = {}) {
    if (!Array.isArray(value)) throw httpError(400, `${label} không hợp lệ`);
    const seen = new Set();
    const items = [];
    for (const item of value) {
        if (typeof item !== "string") throw httpError(400, `${label} không hợp lệ`);
        const name = item.trim();
        if (!name) continue;
        const token = lower ? name.toLowerCase() : name.toUpperCase();
        if (token.length > itemMax || /\s/.test(token) || token.includes("/") || !/^[A-Za-z0-9_-]+$/.test(token)) {
            throw httpError(400, `${label} không hợp lệ`);
        }
        if (allowed && !allowed.includes(token)) throw httpError(400, `${label} không hợp lệ`);
        if (seen.has(token)) continue;
        seen.add(token);
        items.push(token);
    }
    if (items.length > max) throw httpError(400, `${label} quá dài`);
    return items;
}

function readNumberList(value, label) {
    if (!Array.isArray(value)) throw httpError(400, `${label} không hợp lệ`);
    if (value.length > 20) throw httpError(400, `${label} quá dài`);
    return value.map((item) => readNumber(item, label, { min: -1000, max: 1000 }));
}

function readSyncFrom(value) {
    if (value == null || String(value).trim() === "") return null;
    const name = String(value).trim();
    if (name.length > 64 || /\s/.test(name) || name.includes("/")) {
        throw httpError(400, "Sync from không hợp lệ");
    }
    return name;
}

function putBool(input, patch, key, path, label) {
    if (has(input, key)) patch[path] = readBool(input[key], label);
}

function putNum(input, patch, key, path, label, min, max) {
    if (has(input, key)) patch[path] = readNumber(input[key], label, { min, max });
}

function putEnum(input, patch, key, path, label, allowed, current) {
    if (has(input, key)) patch[path] = readEnum(input[key], allowed, label, current);
}

async function updateConfigSummary(actor, username, env, body) {
    const input = body || {};
    const current = await loadOwnedConfig(actor, username, env, PERMISSIONS.CONFIG_EDIT);
    if (!current.trade_config || typeof current.trade_config !== "object") {
        throw httpError(400, "Config chưa có trade_config");
    }
    const trade = current.trade_config;
    const patch = {};

    putBool(input, patch, "on", "trade_config.ON", "On");
    putBool(input, patch, "long", "trade_config.LONG", "Long");
    putBool(input, patch, "short", "trade_config.SHORT", "Short");
    putBool(input, patch, "invert", "trade_config.INVERT", "Invert");
    putBool(input, patch, "paper", "trade_config.PAPER", "Paper");
    putBool(input, patch, "monitor", "trade_config.MONITOR", "Monitor");
    putBool(input, patch, "wl", "trade_config.WL", "Whitelist");
    putBool(input, patch, "autoConfig", "trade_config.AUTO_CONFIG", "Auto config");
    putBool(input, patch, "reportProfit", "trade_config.REPORT_PROFIT", "Report profit");
    putEnum(input, patch, "mode", "trade_config.MARGIN.MODE", "Mode", MODES, trade.MARGIN?.MODE);
    putNum(input, patch, "cost", "trade_config.FIX_COST_AMOUNT", "Cost", 0, 100000000);
    putNum(input, patch, "leverage", "trade_config.LONG_LEVERAGE", "Đòn bẩy long", 1, 125);
    putNum(input, patch, "shortLeverage", "trade_config.SHORT_LEVERAGE", "Đòn bẩy short", 1, 125);
    putNum(input, patch, "level", "trade_config.FIX_LEVERAGE", "Level", 1, 125);
    putNum(input, patch, "ratio", "trade_config.MARGIN.RATIO", "Ratio", 0, 1000);
    putNum(input, patch, "fixloss", "trade_config.MARGIN.FIXLOSS", "Fix loss", 0, 100000000);
    putNum(input, patch, "marginPeriod", "trade_config.MARGIN.PERIOD", "Margin period", 0, 100000);
    putEnum(input, patch, "openType", "trade_config.OPEN.TYPE", "Open type", OPEN_TYPES, trade.OPEN?.TYPE);
    putNum(input, patch, "spread", "trade_config.OPEN.SPREAD", "Spread", -100, 100);
    putNum(input, patch, "wait", "trade_config.OPEN.WAIT", "Wait", 0, 100000);
    putNum(input, patch, "risk", "trade_config.OPEN.RISK", "Risk", 0, 1000);
    putNum(input, patch, "mark", "trade_config.OPEN.MARK", "Mark", 0, 100000);
    putNum(input, patch, "maxPosition", "trade_config.OPEN.MAX_POSITION", "Max position", 0, 100000);
    putBool(input, patch, "filterOn", "trade_config.OPEN.FILTERS.ON", "Filter");
    putNum(input, patch, "chasePct", "trade_config.OPEN.FILTERS.CHASE_PCT", "Chase", 0, 1000);
    putNum(input, patch, "blowAtr", "trade_config.OPEN.FILTERS.BLOW_ATR", "Blow ATR", 0, 1000);
    putNum(input, patch, "fomoAtr", "trade_config.OPEN.FILTERS.FOMO_ATR", "Fomo ATR", 0, 1000);
    putEnum(input, patch, "tpType", "trade_config.TP.TYPE", "TP type", TP_TYPES, trade.TP?.TYPE);
    putNum(input, patch, "tpClose", "trade_config.TP.CLOSE", "Close", 0, 100);
    putNum(input, patch, "tpTime", "trade_config.TP.TIME", "TP time", 0, 100000);
    putBool(input, patch, "tpHold", "trade_config.TP.HOLD", "Hold");
    putEnum(input, patch, "slType", "trade_config.SL.TYPE", "SL type", SL_TYPES, trade.SL?.TYPE);
    putEnum(input, patch, "slCandle", "trade_config.SL.SL_CANDLE", "SL candle", CANDLES, trade.SL?.SL_CANDLE);
    putNum(input, patch, "slPeriod", "trade_config.SL.PERIOD", "SL period", 1, 100000);
    putNum(input, patch, "sl", "trade_config.SL.SL_PERCENT", "SL", -1000, 1000);
    putNum(input, patch, "sli", "trade_config.SL.SLI_PERCENT", "SLI", -1000, 1000);
    putNum(input, patch, "sl2", "trade_config.SL.SL2_PERCENT", "SL2", -1000, 1000);
    putNum(input, patch, "slTime", "trade_config.SL.SL_TIME", "SL time", 0, 100000);
    putNum(input, patch, "maxLoss", "trade_config.SL.MAX_LOSS", "Max loss", -100000000, 100000000);
    putBool(input, patch, "slPosition", "trade_config.SL.POSITION", "SL position");
    putBool(input, patch, "trailing", "trade_config.TRAILING.ON", "Trailing");
    putEnum(input, patch, "trailingType", "trade_config.TRAILING.TYPE", "Trailing type", TRAILING_TYPES, trade.TRAILING?.TYPE);
    putNum(input, patch, "sp", "trade_config.TRAILING.SP_PERCENT", "SP", -1000, 1000);
    putNum(input, patch, "trigger", "trade_config.TRAILING.TRIGGER_PERCENT", "Trigger", -1000, 1000);
    putNum(input, patch, "r", "trade_config.TRAILING.R_PERCENT", "R", -1000, 1000);
    putBool(input, patch, "hp", "trade_config.HP.ON", "HP");
    putNum(input, patch, "hpTrigger", "trade_config.HP.HP_PERCENT_TRIGGER", "HP trigger", -1000, 1000);
    putNum(input, patch, "rhsl", "trade_config.HP.RHSL_PERCENT", "RHSL", -1000, 1000);
    putNum(input, patch, "rh", "trade_config.HP.RH_PERCENT", "RH", -1000, 1000);
    putBool(input, patch, "copy", "trade_config.COPY.ON", "Copy");
    putBool(input, patch, "copyFix", "trade_config.COPY.FIX", "Copy fix");
    putBool(input, patch, "copyDca", "trade_config.COPY.DCA", "Copy DCA");
    putBool(input, patch, "copyFollow", "trade_config.COPY.FOLLOW", "Copy follow");
    putNum(input, patch, "maxVolume", "trade_config.COPY.MAX_VOLUME", "Max volume", 0, 100000000);
    putNum(input, patch, "copyRate", "trade_config.COPY.RATE", "Copy rate", 0, 1000);
    putNum(input, patch, "interval", "trade_config.INTERVAL", "Interval", 1, 86400);
    putNum(input, patch, "syncMarginRatio", "sync_margin_ratio", "Sync margin ratio", 0, 1000);
    putNum(input, patch, "syncWalletBal", "sync_wallet_bal", "Sync wallet", 0, 100000000);
    putBool(input, patch, "syncScale", "sync_scale", "Sync scale");

    if (has(input, "signals")) patch.signals = readTokenList(input.signals, "Signal", { max: 40 });
    if (has(input, "blacklist")) patch.blacklist = readTokenList(input.blacklist, "Blacklist", { max: 200, itemMax: 24 });
    if (has(input, "whitelist")) patch.whitelist = readTokenList(input.whitelist, "Whitelist", { max: 200, itemMax: 24 });
    if (has(input, "symbolTypes")) {
        patch["trade_config.OPEN.SYMBOL_TYPES"] = readTokenList(input.symbolTypes, "Symbol type", { allowed: SYMBOL_TYPES });
    }
    if (has(input, "symbolTypesDeny")) {
        patch["trade_config.OPEN.SYMBOL_TYPES_DENY"] = readTokenList(input.symbolTypesDeny, "Symbol type deny", {
            allowed: SYMBOL_TYPES,
        });
    }
    if (has(input, "filters")) {
        patch["trade_config.OPEN.FILTERS.LIST"] = readTokenList(input.filters, "Filter", { allowed: FILTERS });
    }
    if (has(input, "tpPercent")) patch["trade_config.TP.PERCENT"] = readNumberList(input.tpPercent, "TP");
    if (has(input, "syncExcept")) {
        patch.sync_except = readTokenList(input.syncExcept, "Sync except", { allowed: SYNC_GROUPS, lower: true });
    }
    if (has(input, "syncFrom")) patch.sync_from = readSyncFrom(input.syncFrom);

    if (!Object.keys(patch).length) throw httpError(400, "Không có gì để sửa");
    await AccountConfig.updateOne({ env }, { $set: patch });
    return getConfigDetail(actor, username, env, PERMISSIONS.CONFIG_EDIT);
}

module.exports = {
    MODES,
    OPEN_TYPES,
    SL_TYPES,
    CANDLES,
    TP_TYPES,
    TRAILING_TYPES,
    SYMBOL_TYPES,
    FILTERS,
    SYNC_GROUPS,
    AUDIT_FIELDS,
    toSummary,
    toDetail,
    listConfigSummaries,
    getConfigSummary,
    getConfigDetail,
    updateConfigSummary,
};
