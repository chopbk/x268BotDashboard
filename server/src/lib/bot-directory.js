const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const UserApi = require("../models/user-api");
const WebUser = require("../models/web-user");
const { canAccessBot } = require("../middleware/auth");
const { httpError } = require("./http");
const { defaultTradeConfig } = require("./default-trade-config");

function normalizeName(value) {
    return String(value ?? "").trim();
}

function assertName(name, label) {
    if (!name || name.length > 64 || /\s/.test(name) || name.includes("/")) {
        throw httpError(400, `${label} không hợp lệ`);
    }
}

function toBot(doc) {
    return {
        username: doc.username,
        accounts: doc.accounts || [],
    };
}

function assertCanAccess(user, username) {
    if (!canAccessBot(user, username)) {
        throw httpError(403, "Không có quyền với bot này");
    }
}

async function findBot(username) {
    return UserAccount.findOne({ username });
}

async function requireBot(user, username) {
    assertCanAccess(user, username);
    const bot = await findBot(username);
    if (!bot) throw httpError(404, "Không tìm thấy user bot");
    return bot;
}

async function envOwner(env, exceptUsername) {
    const filter = { accounts: env };
    if (exceptUsername) filter.username = { $ne: exceptUsername };
    return UserAccount.findOne(filter).select("username").lean();
}

async function createBot(username) {
    assertName(username, "Tên user bot");
    const existing = await findBot(username);
    if (existing) throw httpError(409, "User bot đã tồn tại");
    try {
        const created = await UserAccount.create({ username, accounts: [] });
        return toBot(created);
    } catch (error) {
        if (error?.code === 11000) throw httpError(409, "User bot đã tồn tại");
        throw error;
    }
}

async function renameBot(actor, username, nextName) {
    assertName(nextName, "Tên user bot");
    const bot = await requireBot(actor, username);
    if (nextName === username) return toBot(bot);
    const taken = await findBot(nextName);
    if (taken) throw httpError(409, "User bot đã tồn tại");

    bot.username = nextName;
    try {
        await bot.save();
    } catch (error) {
        if (error?.code === 11000) throw httpError(409, "User bot đã tồn tại");
        throw error;
    }

    await UserApi.updateOne({ username }, { $set: { username: nextName } });
    await WebUser.updateMany(
        { botUsernames: username },
        { $set: { "botUsernames.$[name]": nextName } },
        { arrayFilters: [{ name: username }] }
    );
    return toBot(bot);
}

async function deleteBot(actor, username) {
    const bot = await requireBot(actor, username);
    await UserAccount.deleteOne({ _id: bot._id });
    await WebUser.updateMany({ botUsernames: username }, { $pull: { botUsernames: username } });
    return { ok: true };
}

async function ensureAccountConfig(env, siblingEnv) {
    const existing = await AccountConfig.findOne({ env }).select("env").lean();
    if (existing) return;

    const sibling = siblingEnv ? await AccountConfig.findOne({ env: siblingEnv }).lean() : null;
    if (!sibling) {
        await AccountConfig.create({
            env,
            signals: [],
            blacklist: ["BTCUSDT", "ETHUSDT"],
            whitelist: [],
            trade_config: defaultTradeConfig(),
        });
        return;
    }

    const copy = { ...sibling };
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    copy.env = env;
    copy.signals = [];
    copy.blacklist = [];
    copy.whitelist = [];
    copy.sync_from = null;
    copy.sync_except = [];
    copy.sync_scale = false;
    copy.sync_margin_ratio = 0;
    copy.sync_wallet_bal = 0;
    copy.sync_size = null;
    try {
        await AccountConfig.create(copy);
    } catch (error) {
        if (error?.code === 11000) return;
        throw error;
    }
}

async function addAccount(actor, username, env) {
    assertName(env, "Tên config");
    const bot = await requireBot(actor, username);
    const accounts = bot.accounts || [];
    if (accounts.includes(env)) throw httpError(409, "Config đã có trong user bot này");
    const owner = await envOwner(env, username);
    if (owner) throw httpError(409, "Config đang thuộc user bot khác");

    await ensureAccountConfig(env, accounts[0]);
    bot.accounts = [...accounts, env];
    await bot.save();
    return toBot(bot);
}

async function renameAccount(actor, username, env, nextEnv) {
    assertName(nextEnv, "Tên config");
    const bot = await requireBot(actor, username);
    const accounts = [...(bot.accounts || [])];
    const index = accounts.indexOf(env);
    if (index < 0) throw httpError(404, "Không tìm thấy config");
    if (nextEnv !== env) {
        if (accounts.includes(nextEnv)) throw httpError(409, "Config đã có trong user bot này");
        const owner = await envOwner(nextEnv, username);
        if (owner) throw httpError(409, "Config đang thuộc user bot khác");
        accounts[index] = nextEnv;
        bot.accounts = accounts;
        await bot.save();
        await AccountConfig.updateOne({ env }, { $set: { env: nextEnv } });
    }
    return toBot(bot);
}

async function deleteAccount(actor, username, env) {
    const bot = await requireBot(actor, username);
    const accounts = bot.accounts || [];
    if (!accounts.includes(env)) throw httpError(404, "Không tìm thấy config");
    bot.accounts = accounts.filter((name) => name !== env);
    await bot.save();
    const owner = await envOwner(env);
    if (!owner) await AccountConfig.deleteOne({ env });
    return toBot(bot);
}

module.exports = {
    normalizeName,
    createBot,
    renameBot,
    deleteBot,
    addAccount,
    renameAccount,
    deleteAccount,
};
