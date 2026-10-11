const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const AccountStatic = require("../src/models/account-static");
const FuturesProfit = require("../src/models/futures-profit");
const UserApi = require("../src/models/user-api");
const RuntimeLog = require("../src/models/runtime-log");
const ProcessHeartbeat = require("../src/models/process-heartbeat");
const { getDashboard, clearDashboardCache } = require("../src/lib/dashboard");
const { parseAiItems, aiSettings, chatRequest } = require("../src/lib/dashboard-brief");
const { askAttention } = require("../src/lib/dashboard-ai");

const AI_ENV = ["AI_PROVIDER", "AI_MODEL", "GEMINI_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_THINKING", "CLAUDE_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"];

const operator = { id: "op", role: "admin", username: "op", email: "op@x.com", botUsernames: ["V"] };

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        lean() { return Promise.resolve(value); },
    };
}

function installMocks() {
    const originals = {
        users: UserAccount.find,
        configs: AccountConfig.find,
        statics: AccountStatic.aggregate,
        staticFind: AccountStatic.find,
        profits: FuturesProfit.aggregate,
        apis: UserApi.aggregate,
        logs: RuntimeLog.find,
        aggregate: RuntimeLog.aggregate,
        beats: ProcessHeartbeat.find,
    };
    UserAccount.find = () => query([
        { username: "V", accounts: ["V1", "V2"], ownerUserId: "other", active: true },
        { username: "OTHER", accounts: ["O1"], ownerUserId: "other", active: true },
    ]);
    AccountConfig.find = (filter) => query([
        { env: "V1", signals: ["ROSE"], trade_config: { ON: true } },
        { env: "V2", signals: [], trade_config: { ON: true } },
        { env: "O1", signals: ["BULL"], trade_config: { ON: true } },
    ].filter((doc) => !filter?.env?.$in || filter.env.$in.includes(doc.env)));
    AccountStatic.aggregate = async (pipeline) => {
        const id = pipeline?.[1]?.$group?._id;
        if (id && id.signal) return [{ _id: { env: "V1", signal: "TITAN" }, count: 2, profit: -18 }];
        if (id && id.day) {
            return [
                { _id: { env: "V1", day: "2026-10-08" }, profit: 12, trades: 4, wins: 3, losses: 1 },
                { _id: { env: "V1", day: "2026-10-07" }, profit: 5, trades: 1, wins: 1, losses: 0 },
            ];
        }
        return [];
    };
    AccountStatic.find = () => query([
        {
            env: "V1",
            typeSignal: "TITAN",
            symbol: "BTCUSDT",
            side: "LONG",
            profit: -3,
            status: "LOSS",
            closeTime: new Date("2026-10-08T11:00:00Z"),
        },
    ]);
    FuturesProfit.aggregate = async (pipeline) => {
        const id = pipeline?.[1]?.$group?._id;
        if (id && id.day) {
            return [
                { _id: { env: "V1", day: "2026-10-08" }, profit: -40 },
                { _id: { env: "V1", day: "2026-10-07" }, profit: -10 },
            ];
        }
        return [{ _id: "V1", profit: -40 }];
    };
    UserApi.aggregate = async () => [{ username: "V", hasApiKey: false, api_key: "secret-key" }];
    const logs = [
        { at: new Date(), env: "V2", signal: "ROSE", message: "V2 NOT OPEN ROSE LONG BTCUSDT: [V2]Position BTCUSDT is open", source: "callHandleSignalBot", category: "signal" },
        { at: new Date(), env: "V2", signal: "ROSE", message: "V2 NOT OPEN ROSE LONG BTCUSDT: [V2]Position BTCUSDT is open", source: "callHandleSignalBot", category: "signal" },
        { at: new Date(), env: "V2", signal: "ROSE", message: "V2 NOT OPEN ROSE LONG ETHUSDT: symbol exist in blacklist", source: "callHandleSignalBot", category: "signal" },
        { at: new Date(), env: "O1", signal: "BULL", message: "O1 NOT OPEN BULL", source: "callHandleSignalBot", category: "signal" },
        { at: new Date(), env: "V1", signal: "ROSE", message: "gỡ ROSE", source: "autoremove", category: "signal" },
        { at: new Date(), env: "V1", message: "Invalid API-key, IP, or permissions for action", source: "trader", category: "exchange" },
    ];
    RuntimeLog.find = (match) => query(logs.filter((row) => {
        if (match.source && row.source !== match.source) return false;
        if (match.category && row.category !== match.category) return false;
        if (match.env?.$in && !match.env.$in.includes(row.env)) return false;
        return true;
    }));
    RuntimeLog.aggregate = async (pipeline) => {
        const signal = pipeline[0].$match.signal?.$in || [];
        return signal.includes("ROSE") ? [{ _id: "ROSE", count: 2 }] : [{ _id: "BULL", count: 9 }];
    };
    ProcessHeartbeat.find = () => query([
        { at: new Date("2026-10-08T11:59:30Z"), run: ["V"], flags: { trader: true, monitor: false }, mqttConnected: true },
    ]);
    return originals;
}

function restoreMocks(originals) {
    UserAccount.find = originals.users;
    AccountConfig.find = originals.configs;
    AccountStatic.aggregate = originals.statics;
    AccountStatic.find = originals.staticFind;
    FuturesProfit.aggregate = originals.profits;
    UserApi.aggregate = originals.apis;
    RuntimeLog.find = originals.logs;
    RuntimeLog.aggregate = originals.aggregate;
    ProcessHeartbeat.find = originals.beats;
}

const books = {
    readExchangeBooks: async () => ({
        V: {
            source: "exchange",
            positions: [
                { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "0.1", markPrice: "50000", unRealizedProfit: "-120" },
                { symbol: "ETHUSDT", positionSide: "SHORT", positionAmt: "-1", markPrice: "3000", unRealizedProfit: "5" },
            ],
        },
    }),
    cacheTtlMs: 0,
};

test("dashboard stays on owned or assigned bots and hides secrets", async () => {
    const savedAi = AI_ENV.map((name) => [name, process.env[name]]);
    for (const name of AI_ENV) delete process.env[name];
    clearDashboardCache();
    const originals = installMocks();
    try {
        const view = await getDashboard(operator, new Date("2026-10-08T12:00:00Z"), books);
        assert.equal(view.bots.total, 1);
        assert.equal(view.bots.active, 1);
        assert.equal(view.configs.on, 2);
        assert.equal(view.profitToday, 12);
        assert.equal(view.incomeToday, -40);
        assert.equal(view.compare.profitYesterday, 5);
        assert.equal(view.compare.profitDelta, 7);
        assert.equal(view.compare.incomeYesterday, -10);
        assert.equal(view.compare.incomeDelta, -30);
        assert.equal(view.series.days.length, 7);
        assert.equal(view.series.days.at(-1), "2026-10-08");
        assert.equal(view.series.profit.at(-1), 12);
        assert.equal(view.series.income.at(-1), -40);
        assert.equal(view.activity.some((item) => item.kind === "close" && item.title.includes("BTCUSDT")), true);
        assert.equal(view.closedToday.trades, 4);
        assert.equal(view.closedToday.wins, 3);
        assert.equal(view.closedToday.winRate, 75);
        assert.equal(view.openRisk.available, true);
        assert.equal(view.openRisk.positions, 2);
        assert.equal(view.openRisk.unrealized, -115);
        assert.equal(view.openRisk.top[0].symbol, "BTCUSDT");
        assert.equal(view.health.ok, 1);
        assert.equal(view.mine[0].process, "ok");
        assert.equal(view.mine[0].positions, 2);
        assert.equal(view.mine[0].unrealized, -115);
        assert.deepEqual(view.mine.map((row) => row.username), ["V"]);
        assert.equal(view.mine[0].on, 2);
        assert.equal(JSON.stringify(view).includes("secret-key"), false);
        assert.equal(JSON.stringify(view).includes("BULL"), false);
        assert.equal(JSON.stringify(view).includes("OTHER"), false);
        assert.equal(view.attention.some((item) => item.type === "api"), true);
        assert.equal(view.attention.some((item) => item.type === "config" && item.title.includes("V2")), true);
        assert.equal(view.attention.some((item) => /Position .+ is open/i.test(item.title)), false);
        assert.equal(view.attention.filter((item) => item.type === "filter" && item.title.includes("blacklist")).length, 1);
        assert.equal(view.attention.some((item) => item.type === "exchange" && /Invalid API-key/i.test(item.title)), true);
        assert.equal(view.attention.some((item) => item.type === "parse"), false);
        assert.equal(view.attention.some((item) => item.type === "account" && item.severity === "high" && item.title.includes("V ví") && item.title.includes("TITAN")), true);
        assert.equal(view.attention[0].severity, "critical");
        assert.equal(["risk", "exchange"].includes(view.attention[0].type), true);
        assert.equal(view.attention.some((item) => item.type === "risk" && item.severity === "critical"), true);
        assert.equal(view.attention.some((item) => item.type === "loss" && item.title.includes("TITAN")), true);
        assert.equal(view.attention.some((item) => item.type === "removed"), true);
        assert.equal(view.ai.data.skippedNoiseCount >= 2, true);
        assert.equal(view.ai.configured, false);
        assert.equal(view.ai.data.walletLosses[0].username, "V");
        assert.equal(view.ai.data.walletLosses[0].profit, -40);
        assert.equal(view.ai.data.signalLosses[0].signal, "TITAN");
        assert.equal(view.ai.data.openRisk.positions, 2);
        assert.equal(view.ai.prompt.includes("Không nhắc lỗi parse"), true);
        assert.equal(view.ai.prompt.includes("secret-key"), false);
        const kept = parseAiItems(JSON.stringify({
            items: [
                { title: "BULL_VIP lỗi parse 6 lần", href: view.ai.data.signalLosses[0].href },
                { title: "mở trang lạ", href: "https://evil.example" },
                { title: "V lỗ trên ví, TITAN kéo xuống", href: view.ai.data.walletLosses[0].href },
            ],
        }), view.ai.data);
        assert.deepEqual(kept.map((item) => item.title), ["V lỗ trên ví, TITAN kéo xuống"]);
        process.env.AI_PROVIDER = "gemini";
        process.env.GEMINI_API_KEY = "gk";
        const gemini = chatRequest(aiSettings(), "sys", "user");
        assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
        assert.equal(gemini.headers["x-goog-api-key"], "gk");
        delete process.env.GEMINI_API_KEY;
        process.env.AI_PROVIDER = "claude";
        process.env.CLAUDE_API_KEY = "ck";
        const claude = chatRequest(aiSettings(), "sys", "hello");
        assert.equal(claude.url, "https://api.anthropic.com/v1/messages");
        assert.equal(claude.headers["x-api-key"], "ck");
        assert.equal(claude.body.model, "claude-sonnet-4-6");
        delete process.env.CLAUDE_API_KEY;
        process.env.AI_PROVIDER = "deepseek";
        process.env.DEEPSEEK_API_KEY = "dk";
        process.env.AI_MODEL = "deepseek-reasoner";
        const deepseek = chatRequest(aiSettings(), "sys", "user");
        assert.equal(deepseek.url, "https://api.deepseek.com/chat/completions");
        assert.equal(deepseek.body.model, "deepseek-v4-flash");
        assert.equal(deepseek.body.thinking.type, "enabled");
        delete process.env.DEEPSEEK_API_KEY;
        delete process.env.AI_MODEL;
        process.env.AI_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.OPENAI_BASE_URL = "https://ai.example/v1";
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            assert.equal(url, "https://ai.example/v1/chat/completions");
            assert.equal(options.headers.Authorization, "Bearer test-key");
            const body = JSON.parse(options.body);
            assert.equal(body.messages[1].content.includes("TITAN"), true);
            assert.equal(body.messages[1].content.includes("secret-key"), false);
            assert.equal(body.messages[1].content.includes("gk"), false);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [{ message: { content: JSON.stringify({ items: [{ title: "V · V1 · TITAN lỗ hôm nay", href: view.ai.data.signalLosses[0].href }] }) } }],
                }),
            };
        };
        try {
            const ai = await askAttention(operator, { instructions: "Nhắc tài khoản lỗ lớn" });
            assert.equal(ai.items[0].title.includes("TITAN"), true);
            assert.equal(ai.items[0].href, view.ai.data.signalLosses[0].href);
        } finally {
            global.fetch = originalFetch;
        }
    } finally {
        restoreMocks(originals);
        clearDashboardCache();
        for (const [name, value] of savedAi) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});

test("dashboard serves in-memory cache until refresh", async () => {
    clearDashboardCache();
    const originals = installMocks();
    let booksCalls = 0;
    const deps = {
        cacheTtlMs: 60_000,
        readExchangeBooks: async () => {
            booksCalls += 1;
            return books.readExchangeBooks();
        },
    };
    try {
        const first = await getDashboard(operator, new Date("2026-10-08T12:00:00Z"), deps);
        assert.equal(first.cached, false);
        assert.equal(booksCalls, 1);
        const second = await getDashboard(operator, new Date("2026-10-08T12:00:10Z"), deps);
        assert.equal(second.cached, true);
        assert.equal(second.profitToday, 12);
        assert.equal(booksCalls, 1);
        const fresh = await getDashboard(operator, new Date("2026-10-08T12:00:20Z"), { ...deps, refresh: true });
        assert.equal(fresh.cached, false);
        assert.equal(booksCalls, 2);
    } finally {
        restoreMocks(originals);
        clearDashboardCache();
    }
});
