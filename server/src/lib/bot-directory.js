const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const UserApi = require("../models/user-api");
const WebUser = require("../models/web-user");
const { canAccessBot } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { httpError } = require("./http");
const { defaultTradeConfig } = require("./default-trade-config");

function normalizeName(value) {
    return String(value ?? "").trim();
}

/** Tên config/env luôn uppercase — khớp convention binance-bot / lệnh /aa /sc. */
function normalizeEnvName(value) {
    return normalizeName(value).toUpperCase();
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function envRegex(env) {
    return new RegExp(`^${escapeRegex(env)}$`, "i");
}

function sameEnv(a, b) {
    return String(a || "").toUpperCase() === String(b || "").toUpperCase();
}

function findAccountIndex(accounts, env) {
    const list = Array.isArray(accounts) ? accounts : [];
    return list.findIndex((item) => sameEnv(item, env));
}

function assertName(name, label) {
    if (!name || name.length > 64 || /\s/.test(name) || name.includes("/")) {
        throw httpError(400, `${label} không hợp lệ`);
    }
}

async function findConfigByEnvInsensitive(env) {
    const exact = String(env || "");
    if (!exact) return null;
    const hit = await AccountConfig.findOne({ env: exact }).lean();
    if (hit) return hit;
    return AccountConfig.findOne({ env: envRegex(exact) }).lean();
}

function toBot(doc) {
    return {
        username: doc.username,
        accounts: doc.accounts || [],
        ownerUserId: doc.ownerUserId ? String(doc.ownerUserId) : null,
        visibility: doc.visibility || "public",
        active: doc.active !== false,
    };
}

async function findBot(username) {
    return UserAccount.findOne({ username });
}

async function getBot(actor, username, permission = PERMISSIONS.BOTS_VIEW) {
    return toBot(await requireBot(actor, username, permission));
}

async function requireBot(user, username, permission) {
    // Luôn load bot trước khi check quyền — string username không có
    // ownerUserId nên scope own/own_assigned (và private) sẽ fail sai.
    const bot = await findBot(username);
    if (!bot) throw httpError(404, "Không tìm thấy user bot");
    if (!canAccessBot(user, bot, permission)) throw httpError(403, "Không có quyền với bot này");
    return bot;
}

async function envOwner(env, exceptUsername) {
    const filter = { accounts: envRegex(env) };
    if (exceptUsername) filter.username = { $ne: exceptUsername };
    return UserAccount.findOne(filter).select("username accounts").lean();
}

async function createBot(actor, username, visibility = "public", active = true) {
    assertName(username, "Tên user bot");
    if (!["public", "private"].includes(visibility)) throw httpError(400, "Visibility không hợp lệ");
    if (typeof active !== "boolean") throw httpError(400, "Cờ active không hợp lệ");
    const existing = await findBot(username);
    if (existing) throw httpError(409, "User bot đã tồn tại");
    try {
        const created = await UserAccount.create({ username, accounts: [], ownerUserId: actor?.id || null, visibility, active });
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

async function updateBotAccess(actor, username, { visibility, ownerUserId, active }) {
    const bot = await requireBot(actor, username, PERMISSIONS.BOTS_EDIT);
    if (visibility !== undefined) {
        if (!["public", "private"].includes(visibility)) throw httpError(400, "Visibility không hợp lệ");
        bot.visibility = visibility;
    }
    if (active !== undefined) {
        if (typeof active !== "boolean") throw httpError(400, "Cờ active không hợp lệ");
        bot.active = active;
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

/**
 * Tạo Account_Config cho env mới.
 * @param {string} env
 * @param {string} [siblingEnv] — không copyFrom: lấy khung từ sibling, xóa signal (như /aa không copy)
 * @param {object} [sourceDoc] — copyFrom: chép full trade+signal như /aa?copy=
 */
async function ensureAccountConfig(env, siblingEnv, sourceDoc = null) {
    const existing = await findConfigByEnvInsensitive(env);
    if (existing) {
        if (!sameEnv(existing.env, env)) {
            throw httpError(409, `Config đã tồn tại dạng ${existing.env}`);
        }
        return;
    }

    if (sourceDoc) {
        const copy = { ...sourceDoc };
        delete copy._id;
        delete copy.createdAt;
        delete copy.updatedAt;
        copy.env = env;
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
        return;
    }

    const sibling = siblingEnv ? await findConfigByEnvInsensitive(siblingEnv) : null;
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

/**
 * Config nguồn cho copy: actor phải có config.view trên bot đang giữ env đó.
 */
async function requireViewableConfigSource(actor, env) {
    const name = normalizeEnvName(env);
    assertName(name, "Tên config nguồn");
    const owner = await envOwner(name);
    if (!owner?.username) {
        throw httpError(404, `Không tìm thấy config nguồn ${name}`);
    }
    await requireBot(actor, owner.username, PERMISSIONS.CONFIG_VIEW);
    const doc = await findConfigByEnvInsensitive(name);
    if (!doc) throw httpError(404, `Không tìm thấy config nguồn ${name}`);
    return doc;
}

/**
 * @param {object} [options]
 * @param {string} [options.copyFrom] — env nguồn (như /aa?copy=); mọi account actor được xem
 */
async function addAccount(actor, username, env, permission = PERMISSIONS.CONFIG_EDIT, options = {}) {
    const name = normalizeEnvName(env);
    assertName(name, "Tên config");
    const bot = await requireBot(actor, username, permission);
    const accounts = bot.accounts || [];
    if (findAccountIndex(accounts, name) >= 0) {
        throw httpError(409, "Config đã có trong user bot này");
    }
    const owner = await envOwner(name, username);
    if (owner) throw httpError(409, "Config đang thuộc user bot khác");

    const clash = await findConfigByEnvInsensitive(name);
    if (clash && !sameEnv(clash.env, name)) {
        throw httpError(409, `Config đã tồn tại dạng ${clash.env}`);
    }

    const copyFrom = normalizeEnvName(options.copyFrom || "");
    const sourceDoc = copyFrom ? await requireViewableConfigSource(actor, copyFrom) : null;

    await ensureAccountConfig(name, accounts[0], sourceDoc);
    bot.accounts = [...accounts, name];
    await bot.save();
    return toBot(bot);
}

async function renameAccount(actor, username, env, nextEnv, permission = PERMISSIONS.CONFIG_EDIT) {
    const from = normalizeEnvName(env);
    const to = normalizeEnvName(nextEnv);
    assertName(to, "Tên config");
    const bot = await requireBot(actor, username, permission);
    const accounts = [...(bot.accounts || [])];
    const index = findAccountIndex(accounts, from);
    if (index < 0) throw httpError(404, "Không tìm thấy config");
    const current = accounts[index];
    if (sameEnv(current, to)) {
        if (current !== to) {
            accounts[index] = to;
            bot.accounts = accounts;
            await bot.save();
            await AccountConfig.updateOne({ env: current }, { $set: { env: to } });
        }
        return toBot(bot);
    }
    if (findAccountIndex(accounts, to) >= 0) {
        throw httpError(409, "Config đã có trong user bot này");
    }
    const owner = await envOwner(to, username);
    if (owner) throw httpError(409, "Config đang thuộc user bot khác");
    const clash = await findConfigByEnvInsensitive(to);
    if (clash) throw httpError(409, `Config đã tồn tại dạng ${clash.env}`);
    accounts[index] = to;
    bot.accounts = accounts;
    await bot.save();
    const cfg = await findConfigByEnvInsensitive(current);
    if (cfg) await AccountConfig.updateOne({ env: cfg.env }, { $set: { env: to } });
    return toBot(bot);
}

async function copyAccount(actor, sourceUsername, sourceEnv, targetUsername, nextEnv, options = {}) {
    const replace = options.replace === true;
    const sync = options.sync === true;
    if (replace && sync) throw httpError(400, "Không hợp lệ");
    const sourceName = normalizeEnvName(sourceEnv);
    const destName = normalizeEnvName(nextEnv);
    assertName(destName, "Tên config");
    const sourceBot = await requireBot(actor, sourceUsername, PERMISSIONS.CONFIG_VIEW);
    const sourceIdx = findAccountIndex(sourceBot.accounts || [], sourceName);
    if (sourceIdx < 0) throw httpError(404, "Không tìm thấy config");
    const sourceEnvActual = sourceBot.accounts[sourceIdx];
    const targetBot = await requireBot(actor, targetUsername, PERMISSIONS.CONFIG_EDIT);
    if (replace) {
        if (sameEnv(destName, sourceName) && sourceUsername === targetUsername) {
            throw httpError(400, "Không copy một config vào chính nó");
        }
        const destIdx = findAccountIndex(targetBot.accounts || [], destName);
        if (destIdx < 0) throw httpError(404, "Không tìm thấy config đích");
        const destActual = targetBot.accounts[destIdx];
        const source = await findConfigByEnvInsensitive(sourceEnvActual);
        if (!source) throw httpError(404, "Không tìm thấy config");
        const updated = await AccountConfig.updateOne({ env: destActual }, {
            $set: {
                signals: source.signals || [],
                blacklist: source.blacklist || [],
                whitelist: source.whitelist || [],
                trade_config: source.trade_config || {},
                sync_from: null,
                sync_except: [],
                sync_scale: false,
                sync_margin_ratio: 0,
                sync_wallet_bal: 0,
                sync_size: null,
            },
        });
        if (!updated.matchedCount) throw httpError(404, "Không tìm thấy config đích");
        return { username: targetBot.username, env: destActual, replaced: true };
    }
    if (findAccountIndex(targetBot.accounts || [], destName) >= 0) {
        throw httpError(409, "Config đã có trong user bot này");
    }
    const owner = await envOwner(destName);
    if (owner) throw httpError(409, "Config đang thuộc user bot khác");
    const taken = await findConfigByEnvInsensitive(destName);
    if (taken) throw httpError(409, `Tên config đã tồn tại (${taken.env})`);

    const source = await findConfigByEnvInsensitive(sourceEnvActual);
    if (!source) throw httpError(404, "Không tìm thấy config");
    const copy = { ...source };
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    copy.env = destName;
    copy.sync_from = sync ? sourceEnvActual : null;
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
    targetBot.accounts = [...(targetBot.accounts || []), destName];
    await targetBot.save();
    return { username: targetBot.username, env: destName };
}

async function deleteAccount(actor, username, env, permission = PERMISSIONS.CONFIG_EDIT) {
    const name = normalizeEnvName(env);
    const bot = await requireBot(actor, username, permission);
    const accounts = bot.accounts || [];
    const index = findAccountIndex(accounts, name);
    if (index < 0) throw httpError(404, "Không tìm thấy config");
    const actual = accounts[index];
    bot.accounts = accounts.filter((_, i) => i !== index);
    await bot.save();
    const owner = await envOwner(actual);
    if (!owner) {
        const cfg = await findConfigByEnvInsensitive(actual);
        if (cfg) await AccountConfig.deleteOne({ env: cfg.env });
    }
    return toBot(bot);
}

module.exports = {
    normalizeName,
    normalizeEnvName,
    sameEnv,
    getBot,
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
