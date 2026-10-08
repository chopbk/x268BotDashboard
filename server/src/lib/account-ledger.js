const UserAccount = require("../models/user-account");
const UserApi = require("../models/user-api");
const FuturesProfit = require("../models/futures-profit");
const AccountStatic = require("../models/account-static");
const { PERMISSIONS, canAccessResource } = require("../auth/access-control");
const { httpError } = require("./http");
const { safeRecordAudit } = require("./audit");
const {
    toNum,
    createBinanceFutures,
    loadPriceMap,
    quoteUsdt,
} = require("./binance-futures");

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_CHOICES = new Set([7, 14, 30, 90]);
const TRADING_TYPES = new Set([
    "REALIZED_PNL",
    "COMMISSION",
    "FUNDING_FEE",
    "REFERRAL_KICKBACK",
    "COMMISSION_REBATE",
    "API_REBATE",
    "FEE_RETURN",
]);
const CASH_TYPES = new Set([
    "TRANSFER",
    "INTERNAL_TRANSFER",
    "ASSET_TRANSFER",
    "CROSS_COLLATERAL_TRANSFER",
    "DEPOSIT",
    "WITHDRAW",
]);
const CONVERSION_TYPES = new Set(["COIN_SWAP_DEPOSIT", "COIN_SWAP_WITHDRAW", "AUTO_EXCHANGE"]);

function r3(value) {
    return Math.round(toNum(value) * 1000) / 1000;
}

function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
}

function ymd(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function ledgerEnv(user) {
    const accounts = (user?.accounts || []).map((item) => String(item).toUpperCase());
    const name = String(user?.username || "").toUpperCase();
    if (accounts.includes(name)) return name;
    return accounts[0] || name;
}

function classifyIncome(incomeByType) {
    const out = { trading: 0, fee: 0, funding: 0, rebate: 0, cashIn: 0, cashOut: 0, transferIn: 0, transferOut: 0, conversion: 0 };
    for (const [type, raw] of Object.entries(incomeByType || {})) {
        const value = toNum(raw);
        const name = String(type).toUpperCase();
        if (name === "COMMISSION") out.fee += value;
        else if (name === "FUNDING_FEE") out.funding += value;
        else if (name === "REALIZED_PNL") out.trading += value;
        else if (TRADING_TYPES.has(name)) out.rebate += value;
        else if (CONVERSION_TYPES.has(name)) out.conversion += value;
        else if (CASH_TYPES.has(name)) {
            if (value >= 0) out.cashIn += value;
            else out.cashOut += value;
            if (name !== "DEPOSIT" && name !== "WITHDRAW") {
                if (value >= 0) out.transferIn += value;
                else out.transferOut += value;
            }
        }
    }
    out.trading += out.fee + out.funding + out.rebate;
    return out;
}

function walletOf(doc) {
    return doc?.stats && doc.stats.wallet && typeof doc.stats.wallet === "object" ? doc.stats.wallet : {};
}

function dayRow(doc) {
    const wallet = walletOf(doc);
    const classified = classifyIncome(wallet.incomeByType);
    const hasTypes = wallet.incomeByType && Object.keys(wallet.incomeByType).length > 0;
    return {
        ymd: ymd(doc.day),
        balance: doc.balance == null ? null : r3(doc.balance),
        profit: r3(doc.profit),
        fee: r3(hasTypes ? classified.fee : doc.fee),
        funding: r3(hasTypes ? classified.funding : doc.funding),
        rebate: r3(hasTypes ? classified.rebate : doc.ref),
        trading: r3(hasTypes ? classified.trading : doc.profit),
        cashIn: r3(wallet.cashIn != null ? wallet.cashIn : classified.cashIn),
        cashOut: r3(wallet.cashOut != null ? wallet.cashOut : classified.cashOut),
        transferIn: r3(wallet.transferIn != null ? wallet.transferIn : classified.transferIn),
        transferOut: r3(wallet.transferOut != null ? wallet.transferOut : classified.transferOut),
        conversion: r3(wallet.conversion != null ? wallet.conversion : classified.conversion),
        incomeByType: wallet.incomeByType || {},
        unrealized: wallet.unPnlNow == null ? null : r3(wallet.unPnlNow),
        available: wallet.available == null ? null : r3(wallet.available),
        margin: wallet.margin == null ? null : r3(wallet.margin),
        exchangeBalance: wallet.exchangeBalance == null ? null : r3(wallet.exchangeBalance),
        dbBalanceBefore: wallet.dbBalanceBefore == null ? null : r3(wallet.dbBalanceBefore),
        asOf: wallet.asOf || null,
        cashEntries: Array.isArray(wallet.cashEntries) ? wallet.cashEntries : [],
    };
}

function summarizeLedger(docs, staticProfit = 0) {
    const days = (docs || []).filter((doc) => doc && doc.day).map(dayRow);
    const totals = days.reduce((sum, day) => {
        sum.trading += day.trading;
        sum.profit += day.profit;
        sum.fee += day.fee;
        sum.funding += day.funding;
        sum.rebate += day.rebate;
        sum.cashIn += day.cashIn;
        sum.cashOut += day.cashOut;
        sum.transferIn += day.transferIn;
        sum.transferOut += day.transferOut;
        sum.conversion += day.conversion;
        return sum;
    }, { trading: 0, profit: 0, fee: 0, funding: 0, rebate: 0, cashIn: 0, cashOut: 0, transferIn: 0, transferOut: 0, conversion: 0 });
    for (const key of Object.keys(totals)) totals[key] = r3(totals[key]);
    totals.staticProfit = r3(staticProfit);
    totals.staticDiff = r3(totals.profit - staticProfit);
    const last = days[days.length - 1] || null;
    const today = ymd(startOfUtcDay(new Date()));
    const exchange = last && last.ymd === today
        ? (last.exchangeBalance != null ? last.exchangeBalance : last.balance)
        : null;
    return {
        days,
        totals,
        live: last && last.ymd === today ? {
            wallet: last.balance,
            available: last.available,
            unrealized: last.unrealized,
            margin: last.margin,
            asOf: last.asOf,
        } : { wallet: last?.balance ?? null, available: null, unrealized: null, margin: null, asOf: last?.asOf || null },
        compare: {
            dbBalance: last?.balance ?? null,
            exchangeBalance: exchange,
            before: last?.dbBalanceBefore ?? null,
            diff: exchange == null || last?.dbBalanceBefore == null ? null : r3(exchange - last.dbBalanceBefore),
        },
        flows: days.filter((day) => day.cashIn || day.cashOut || day.conversion || day.cashEntries.length),
    };
}

async function visibleUsers(actor) {
    const rows = await UserAccount.find({}).select("username accounts ownerUserId visibility active").lean();
    return rows
        .filter((row) => row?.username && canAccessResource(actor, PERMISSIONS.STATISTICS_VIEW, row))
        .map((row) => ({
            username: row.username,
            accounts: row.accounts || [],
            active: row.active !== false,
            ownerUserId: row.ownerUserId ? String(row.ownerUserId) : null,
        }))
        .sort((a, b) => a.username.localeCompare(b.username));
}

function isOwnUser(actor, user) {
    const id = String(actor?.id || "");
    if (user?.ownerUserId && user.ownerUserId === id) return true;
    if (!user?.ownerUserId && [actor?.username, actor?.email].filter(Boolean).includes(user?.username)) return true;
    return (actor?.botUsernames || []).includes(user?.username);
}

function pickUser(users, username, actor) {
    if (username) {
        const found = users.find((user) => user.username.toLowerCase() === String(username).toLowerCase());
        if (!found) throw httpError(404, "Không tìm thấy user bot");
        return found;
    }
    const owned = users.find((user) => user.ownerUserId && user.ownerUserId === String(actor?.id || "") && user.active);
    return owned || users.find((user) => user.active) || users[0] || null;
}

async function staticProfit(accounts, from, to) {
    const envs = [...new Set((accounts || []).map((item) => String(item)).filter(Boolean))];
    if (!envs.length) return 0;
    const upper = envs.map((item) => item.toUpperCase());
    const rows = await AccountStatic.aggregate([
        {
            $match: {
                env: { $in: [...envs, ...upper] },
                isPaper: { $ne: true },
                closeTime: { $gte: from, $lt: to },
            },
        },
        { $group: { _id: null, profit: { $sum: "$profit" } } },
    ]);
    return rows[0]?.profit || 0;
}

async function loadLedger(actor, query = {}) {
    const days = DAY_CHOICES.has(Number(query.days)) ? Number(query.days) : 14;
    const users = await visibleUsers(actor);
    const user = pickUser(users, query.username, actor);
    const today = startOfUtcDay(new Date());
    const from = addUtcDays(today, 1 - days);
    const to = addUtcDays(today, 1);
    if (!user) {
        return { users: [], username: null, env: null, days, from: ymd(from), to: ymd(today), series: [], totals: summarizeLedger([]).totals, live: {}, compare: {}, flows: [] };
    }
    const env = ledgerEnv(user);
    const docs = await FuturesProfit.find({
        env: { $in: [env, user.username] },
        day: { $gte: from, $lt: to },
    }).sort({ day: 1 }).lean();
    const byDay = new Map();
    for (const doc of docs) {
        const key = ymd(doc.day);
        const current = byDay.get(key);
        if (!current || String(doc.env).toUpperCase() === env) byDay.set(key, doc);
    }
    const summary = summarizeLedger([...byDay.values()], await staticProfit(user.accounts.length ? user.accounts : [env], from, to));
    return {
        users: users.map((item) => ({ username: item.username, active: item.active, mine: isOwnUser(actor, item) })),
        username: user.username,
        env,
        days,
        from: ymd(from),
        to: ymd(today),
        series: summary.days,
        totals: summary.totals,
        live: summary.live,
        compare: summary.compare,
        flows: summary.flows,
    };
}

function incomeTotals(rows, prices) {
    const by = {};
    const entries = [];
    let profit = 0;
    let fee = 0;
    let funding = 0;
    let rebate = 0;
    for (const row of rows) {
        const type = String(row.incomeType || "OTHER").toUpperCase();
        const amount = quoteUsdt(row.asset, toNum(row.income), prices);
        by[type] = r3((by[type] || 0) + amount);
        if (type === "REALIZED_PNL") profit += amount;
        else if (type === "COMMISSION") fee += amount;
        else if (type === "FUNDING_FEE") funding += amount;
        else if (TRADING_TYPES.has(type)) rebate += amount;
        if (CASH_TYPES.has(type) || CONVERSION_TYPES.has(type)) {
            entries.push({
                time: row.time || null,
                type,
                asset: String(row.asset || "USDT").toUpperCase(),
                income: r3(amount),
            });
        }
    }
    const net = profit + fee + funding + rebate;
    return { by, entries: entries.slice(-40), profit: net, fee, funding, rebate };
}

function snapshotWallet(rows, prices) {
    let wallet = 0;
    let unrealized = 0;
    const assets = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const asset = String(row.asset || "").toUpperCase();
        if (!asset) continue;
        const amount = toNum(row.balance);
        const upnl = toNum(row.crossUnPnl);
        if (!amount && !upnl) continue;
        const quoted = quoteUsdt(asset, amount, prices);
        wallet += quoted;
        unrealized += quoteUsdt(asset, upnl, prices);
        assets.push({ asset, amount: r3(amount), usdt: r3(quoted) });
    }
    assets.sort((a, b) => Math.abs(b.usdt) - Math.abs(a.usdt));
    return { wallet: r3(wallet), unrealized: r3(unrealized), assets };
}

async function fetchTodayIncome(client, startMs, endMs) {
    const rows = [];
    let startTime = startMs;
    for (let page = 0; page < 3; page += 1) {
        const batch = await client.signedGet("/fapi/v1/income", { startTime, endTime: endMs, limit: 1000 });
        if (!Array.isArray(batch) || !batch.length) break;
        rows.push(...batch);
        if (batch.length < 1000) break;
        const last = Number(batch[batch.length - 1].time);
        if (!last || last <= startTime) break;
        startTime = last;
    }
    return rows;
}

async function refreshLedger(actor, username, options = {}) {
    const viewUsers = await visibleUsers(actor);
    const user = pickUser(viewUsers, username, actor);
    if (!user) throw httpError(404, "Không tìm thấy user bot");
    const api = await UserApi.findOne({ username: new RegExp(`^${String(user.username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })
        .select("username exchange api_key api_secret")
        .lean();
    if (!api?.api_key || !api?.api_secret) throw httpError(400, "User chưa có API key");
    const exchange = String(api.exchange || "binance").toLowerCase();
    if (exchange !== "binance") throw httpError(400, "Cập nhật hôm nay chỉ hỗ trợ Binance futures");

    const client = createBinanceFutures({
        apiKey: api.api_key,
        apiSecret: api.api_secret,
        fetchImpl: options.fetchImpl || fetch,
    });
    const [account, balances, prices] = await Promise.all([
        client.signedGet("/fapi/v2/account"),
        client.signedGet("/fapi/v2/balance"),
        loadPriceMap(client),
    ]);
    const today = startOfUtcDay(new Date());
    const now = new Date();
    const incomeRows = await fetchTodayIncome(client, today.getTime(), now.getTime());
    const income = incomeTotals(incomeRows, prices);
    const quoted = snapshotWallet(balances, prices);
    const wallet = toNum(account.totalWalletBalance) || quoted.wallet;
    const available = account.availableBalance == null ? null : r3(account.availableBalance);
    const unrealized = account.totalUnrealizedProfit == null ? quoted.unrealized : r3(account.totalUnrealizedProfit);
    const margin = account.totalInitialMargin == null ? null : r3(account.totalInitialMargin);
    const env = ledgerEnv(user);
    const existing = await FuturesProfit.findOne({ env, day: today }).lean();
    const previous = await FuturesProfit.findOne({ env, day: addUtcDays(today, -1) }).select("balance").lean();
    const before = existing?.balance != null ? r3(existing.balance) : (previous?.balance != null ? r3(previous.balance) : null);
    const classified = classifyIncome(income.by);
    const roi = previous?.balance > 0 ? r3((income.profit * 100) / previous.balance) : null;
    const walletBlock = {
        ...(existing?.stats?.wallet || {}),
        quote: "USDT",
        eod: r3(wallet),
        start: previous?.balance == null ? null : r3(previous.balance),
        profit: r3(income.profit),
        fee: r3(income.fee),
        funding: r3(income.funding),
        ref: r3(income.rebate),
        available,
        margin,
        unPnlNow: unrealized,
        exchangeBalance: r3(wallet),
        dbBalanceBefore: before,
        asOf: now.toISOString(),
        assets: quoted.assets,
        incomeByType: income.by,
        cashIn: r3(classified.cashIn),
        cashOut: r3(classified.cashOut),
        transferIn: r3(classified.transferIn),
        transferOut: r3(classified.transferOut),
        conversion: r3(classified.conversion),
        cashEntries: income.entries,
        source: "binance",
        user: String(user.username).toUpperCase(),
    };
    await FuturesProfit.findOneAndUpdate(
        { env, day: today },
        {
            $set: {
                env,
                day: today,
                profit: r3(income.profit),
                fee: r3(income.fee),
                ref: r3(income.rebate),
                funding: r3(income.funding),
                balance: r3(wallet),
                roi,
                status: income.profit < 0 ? "LOSE" : income.profit > 0 ? "WIN" : "DRAW",
                stats: { ...(existing?.stats || {}), wallet: walletBlock },
            },
        },
        { upsert: true }
    );
    await safeRecordAudit({
        action: "account.ledger_refreshed",
        actor,
        targetType: "bot",
        target: { username: user.username },
        changes: { balance: { from: before, to: r3(wallet) }, day: { from: null, to: ymd(today) } },
    });
    const days = [7, 14, 30, 90].includes(Number(options.days)) ? Number(options.days) : 14;
    return loadLedger(actor, { username: user.username, days });
}

module.exports = {
    ledgerEnv,
    isOwnUser,
    classifyIncome,
    summarizeLedger,
    loadLedger,
    refreshLedger,
};
