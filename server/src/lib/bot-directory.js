const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const UserApi = require("../models/user-api");
const WebUser = require("../models/web-user");
const { canAccessBot } = require("../middleware/auth");
const { PERMISSIONS, scopeForPermission } = require("../auth/access-control");
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
        ownerUserId: doc.ownerUserId ? String(doc.ownerUserId) : null,
        visibility: doc.visibility || "public",
    };
}

async function findBot(username) {
    return UserAccount.findOne({ username });
}

async function requireBot(user, username, permission) {
    const scope = scopeForPermission(user, permission);
    if (scope === "assigned" && !canAccessBot(user, username, permission)) throw httpError(403, "Không có quyền với bot này");
    if (scope === "own_assigned" && !user?.id && !canAccessBot(user, username, permission)) throw httpError(403, "Không có quyền với bot này");
    const bot = await findBot(username);
    if (!bot) throw httpError(404, "Không tìm thấy user bot");
    if (!canAccessBot(user, bot, permission)) throw httpError(403, "Không có quyền với bot này");
    return bot;
}

async function envOwner(env, exceptUsername) {
    const filter = { accounts: env };
    if (exceptUsername) filter.username = { $ne: exceptUsername };
    return UserAccount.findOne(filter).select("username").lean();
}

async function createBot(actor, username, visibility = "public") {
    assertName(username, "Tên user bot");
    if (!["public", "private"].includes(visibility)) throw httpError(400, "Visibility không hợp lệ");
    const existing = await findBot(username);
    if (existing) throw httpError(409, "User bot đã tồn tại");
    try {
        const created = await UserAccount.create({ username, accounts: [], ownerUserId: actor?.id || null, visibility });
        return toBot(created);
    } catch (error) {
        if (error?.code === 11000) throw httpError(409, "User bot đã tồn tại");
        throw error;
    }
}

async function renameBot(actor, username, nextName, permission = PERMISSIONS.BOTS_EDIT) {
    assertName(nextName, "Tên user bot");
    const bot = await requireBot(actor, username, permission);
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

async function updateBotAccess(actor, username, { visibility, ownerUserId }) {
    const bot = await requireBot(actor, username, PERMISSIONS.BOTS_EDIT);
    if (visibility !== undefined) {
        if (!["public", "private"].includes(visibility)) throw httpError(400, "Visibility không hợp lệ");
        bot.visibility = visibility;
    }
    if (ownerUserId !== undefined) {
        if (actor?.role !== "admin") throw httpError(403, "Chỉ admin được đổi chủ sở hữu");
        if (ownerUserId && !WebUser.db.base.Types.ObjectId.isValid(ownerUserId)) throw httpError(400, "Chủ sở hữu không hợp lệ");
        if (ownerUserId && !(await WebUser.findById(ownerUserId).select("_id").lean())) throw httpError(400, "Không tìm thấy chủ sở hữu");
        bot.ownerUserId = ownerUserId || null;
    }
    await bot.save();
    return toBot(bot);
}

async function deleteBot(actor, username, permission = PERMISSIONS.BOTS_DELETE) {
    const bot = await requireBot(actor, username, permission);
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

async function addAccount(actor, username, env, permission = PERMISSIONS.CONFIG_EDIT) {
    assertName(env, "Tên config");
    const bot = await requireBot(actor, username, permission);
    const accounts = bot.accounts || [];
    if (accounts.includes(env)) throw httpError(409, "Config đã có trong user bot này");
    const owner = await envOwner(env, username);
    if (owner) throw httpError(409, "Config đang thuộc user bot khác");

    await ensureAccountConfig(env, accounts[0]);
    bot.accounts = [...accounts, env];
    await bot.save();
    return toBot(bot);
}

async function renameAccount(actor, username, env, nextEnv, permission = PERMISSIONS.CONFIG_EDIT) {
    assertName(nextEnv, "Tên config");
    const bot = await requireBot(actor, username, permission);
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

async function copyAccount(actor, sourceUsername, sourceEnv, targetUsername, nextEnv) {
    assertName(nextEnv, "Tên config");
    const sourceBot = await requireBot(actor, sourceUsername, PERMISSIONS.CONFIG_EDIT);
    if (!(sourceBot.accounts || []).includes(sourceEnv)) throw httpError(404, "Không tìm thấy config");
    const targetBot = await requireBot(actor, targetUsername, PERMISSIONS.CONFIG_EDIT);
    if ((targetBot.accounts || []).includes(nextEnv)) throw httpError(409, "Config đã có trong user bot này");
    const owner = await envOwner(nextEnv);
    if (owner) throw httpError(409, "Config đang thuộc user bot khác");
    const taken = await AccountConfig.findOne({ env: nextEnv }).select("env").lean();
    if (taken) throw httpError(409, "Tên config đã tồn tại");

    const source = await AccountConfig.findOne({ env: sourceEnv }).lean();
    if (!source) throw httpError(404, "Không tìm thấy config");
    const copy = { ...source };
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    copy.env = nextEnv;
    copy.sync_from = null;
    copy.sync_except = [];
    copy.sync_scale = false;
    copy.sync_margin_ratio = 0;
    copy.sync_wallet_bal = 0;
    copy.sync_size = null;
    try {
        await AccountConfig.create(copy);
    } catch (error) {
        if (error?.code === 11000) throw httpError(409, "Tên config đã tồn tại");
        throw error;
    }
    targetBot.accounts = [...(targetBot.accounts || []), nextEnv];
    await targetBot.save();
    return { username: targetBot.username, env: nextEnv };
}

async function deleteAccount(actor, username, env, permission = PERMISSIONS.CONFIG_EDIT) {
    const bot = await requireBot(actor, username, permission);
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
    requireBot,
    createBot,
    renameBot,
    updateBotAccess,
    deleteBot,
    addAccount,
    renameAccount,
    deleteAccount,
    copyAccount,
};
