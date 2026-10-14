/**
 * Factory: account → ExchangeFuturesAdapter.
 * Mọi nơi giao tiếp sàn đi qua getExchangeAdapter(account).
 */

const UserApi = require("../../models/user-api");
const { httpError } = require("../http");
const { normalizeExchangeId, getRegistryEntry, displayNameOf } = require("./registry");
const { BinanceFuturesAdapter } = require("./binance-futures-adapter");
const { BybitLinearAdapter } = require("./bybit-linear-adapter");
const { AsterFuturesAdapter } = require("./aster-futures-adapter");
const { OkxSwapAdapter } = require("./okx-swap-adapter");
const { exchangeError } = require("./errors");

const ADAPTERS = {
    binance: BinanceFuturesAdapter,
    bybit: BybitLinearAdapter,
    aster: AsterFuturesAdapter,
    okex: OkxSwapAdapter,
};

function exactName(username) {
    return new RegExp(`^${String(username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

function createAdapterFromApi(api, { fetchImpl } = {}) {
    if (!api?.api_key || !api?.api_secret) {
        throw httpError(400, "User chưa có API key");
    }
    const exchange = normalizeExchangeId(api.exchange || "binance");
    const entry = getRegistryEntry(exchange);
    if (!entry || !ADAPTERS[exchange]) {
        throw exchangeError("unsupported", `Sàn ${api.exchange || exchange} chưa có adapter trên web`, {
            exchange,
            code: "no_adapter",
        });
    }
    const Adapter = ADAPTERS[exchange];
    return new Adapter({
        account: String(api.username || "").trim(),
        exchange,
        apiKey: api.api_key,
        apiSecret: api.api_secret,
        password: api.password || "",
        fetchImpl,
    });
}

/**
 * @param {string|{ username?: string, exchange?: string, api_key?: string, api_secret?: string, password?: string }} accountOrApi
 * @param {{ fetchImpl?: typeof fetch, UserApi?: object }} [deps]
 */
async function getExchangeAdapter(accountOrApi, deps = {}) {
    if (accountOrApi && typeof accountOrApi === "object" && accountOrApi.api_key) {
        return createAdapterFromApi(accountOrApi, deps);
    }
    const account = typeof accountOrApi === "string"
        ? accountOrApi
        : (accountOrApi?.username || accountOrApi?.account || accountOrApi?.env || "");
    const name = String(account || "").trim();
    if (!name) throw httpError(400, "Thiếu account");

    const Model = deps.UserApi || UserApi;
    const api = await Model.findOne({ username: exactName(name) })
        .select("username exchange api_key api_secret password")
        .lean();
    if (!api) throw httpError(400, `Account ${name} chưa có User API`);
    return createAdapterFromApi(api, deps);
}

async function resolveAccountExchange(account, deps = {}) {
    const name = String(account || "").trim();
    if (!name) return "unknown";
    try {
        // Tránh mongoose buffer timeout khi Redis read chạy ngoài request có Mongo
        // (position-sync test, local book, …).
        if (!deps.UserApi) {
            const mongoose = require("mongoose");
            if (mongoose.connection.readyState !== 1) return "unknown";
        }
        const Model = deps.UserApi || UserApi;
        const api = await Model.findOne({ username: exactName(name) }).select("exchange").lean();
        if (!api?.exchange) return "unknown";
        const id = normalizeExchangeId(api.exchange);
        return getRegistryEntry(id) ? id : "unknown";
    } catch (error) {
        console.error("[resolveAccountExchange]", error.message);
        return "unknown";
    }
}

function capabilitiesForExchange(exchange) {
    const entry = getRegistryEntry(exchange);
    if (!entry) {
        return {
            snapshot: false,
            history: false,
            open: false,
            close: false,
            reverse: false,
            regularOrder: false,
            conditionalOrder: false,
            tpsl: false,
            trailing: false,
        };
    }
    return { ...entry.supports };
}

module.exports = {
    ADAPTERS,
    getExchangeAdapter,
    createAdapterFromApi,
    resolveAccountExchange,
    capabilitiesForExchange,
    displayNameOf,
    normalizeExchangeId,
};
