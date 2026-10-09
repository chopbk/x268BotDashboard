const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const AccountStatic = require("../src/models/account-static");
const FuturesProfit = require("../src/models/futures-profit");
const UserApi = require("../src/models/user-api");
const RuntimeLog = require("../src/models/runtime-log");
const { getDashboard } = require("../src/lib/dashboard");
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

test("dashboard stays on owned or assigned bots and hides secrets", async () => {
    const savedAi = AI_ENV.map((name) => [name, process.env[name]]);
    for (const name of AI_ENV) delete process.env[name];
    const originals = {
        users: UserAccount.find,
        configs: AccountConfig.find,
        statics: AccountStatic.aggregate,
        profits: FuturesProfit.aggregate,
        apis: UserApi.aggregate,
        logs: RuntimeLog.find,
        aggregate: RuntimeLog.aggregate,
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
        return [{ _id: "V1", profit: 12 }, { _id: "O1", profit: 99 }];
    };
    FuturesProfit.aggregate = async () => [{ _id: "V1", profit: -40 }];
    UserApi.aggregate = async () => [{ username: "V", hasApiKey: false, api_key: "secret-key" }];
    const logs = [
        { at: new Date(), env: "V2", signal: "ROSE", message: "NOT OPEN ROSE blacklist", source: "callHandleSignalBot" },
        { at: new Date(), env: "O1", signal: "BULL", message: "NOT OPEN BULL", source: "callHandleSignalBot" },
        { at: new Date(), env: "V1", signal: "ROSE", message: "gỡ ROSE", source: "autoremove" },
    ];
    RuntimeLog.find = (match) => query(logs.filter((row) => row.source === match.source && (!match.env?.$in || match.env.$in.includes(row.env))));
    RuntimeLog.aggregate = async (pipeline) => {
        const signal = pipeline[0].$match.signal?.$in || [];
        return signal.includes("ROSE") ? [{ _id: "ROSE", count: 2 }] : [{ _id: "BULL", count: 9 }];
    };
    try {
        const view = await getDashboard(operator, new Date("2026-10-08T12:00:00Z"));
        assert.equal(view.bots.total, 1);
        assert.equal(view.bots.active, 1);
        assert.equal(view.configs.on, 2);
        assert.equal(view.profitToday, 12);
        assert.equal(view.incomeToday, -40);
        assert.deepEqual(view.mine.map((row) => row.username), ["V"]);
        assert.equal(view.mine[0].on, 2);
        assert.equal(JSON.stringify(view).includes("secret-key"), false);
        assert.equal(JSON.stringify(view).includes("BULL"), false);
        assert.equal(JSON.stringify(view).includes("OTHER"), false);
        assert.equal(view.attention.some((item) => item.type === "api"), true);
        assert.equal(view.attention.some((item) => item.type === "config" && item.title.includes("V2")), true);
        assert.equal(view.attention.some((item) => item.type === "blocked" && item.title.includes("V2")), true);
        assert.equal(view.attention.some((item) => item.type === "parse"), false);
        assert.equal(view.attention.some((item) => item.type === "account" && item.title.includes("V lỗ") && item.title.includes("TITAN")), true);
        assert.equal(view.attention[0].type, "account");
        assert.equal(view.attention.some((item) => item.type === "loss" && item.title.includes("V · V1 · TITAN")), true);
        assert.equal(view.attention.some((item) => item.type === "removed"), true);
        assert.equal(view.ai.configured, false);
        assert.equal(view.ai.data.walletLosses[0].username, "V");
        assert.equal(view.ai.data.walletLosses[0].profit, -40);
        assert.equal(view.ai.data.signalLosses[0].signal, "TITAN");
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
        UserAccount.find = originals.users;
        AccountConfig.find = originals.configs;
        AccountStatic.aggregate = originals.statics;
        FuturesProfit.aggregate = originals.profits;
        UserApi.aggregate = originals.apis;
        RuntimeLog.find = originals.logs;
        RuntimeLog.aggregate = originals.aggregate;
        for (const [name, value] of savedAi) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});
