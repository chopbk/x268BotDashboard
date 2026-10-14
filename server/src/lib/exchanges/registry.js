/**
 * Source of truth: display name + default capability matrix per exchange.
 * capabilities() trên adapter có thể thu hẹp theo account (hedge/unified/…).
 */

const READ_ONLY = Object.freeze({
    snapshot: true,
    history: false,
    open: false,
    close: false,
    reverse: false,
    regularOrder: false,
    conditionalOrder: false,
    tpsl: false,
    trailing: false,
});

const BINANCE_FULL = Object.freeze({
    snapshot: true,
    history: true,
    open: true,
    close: true,
    reverse: true,
    regularOrder: true,
    conditionalOrder: true,
    tpsl: true,
    trailing: true,
});

const REGISTRY = Object.freeze({
    binance: {
        id: "binance",
        displayName: "Binance Futures",
        supports: BINANCE_FULL,
    },
    bybit: {
        id: "bybit",
        displayName: "Bybit Linear",
        // Phase 1: read-only. Mutation bật sau adapter test.
        supports: { ...READ_ONLY },
    },
    aster: {
        id: "aster",
        displayName: "Aster Futures",
        // Không mặc định Binance-compatible cho mutation.
        supports: { ...READ_ONLY },
    },
    okex: {
        id: "okex",
        displayName: "OKX Swap",
        supports: { ...READ_ONLY },
    },
});

const ALIASES = Object.freeze({
    bybitv5: "bybit",
    okx: "okex",
    "okx-swap": "okex",
});

function normalizeExchangeId(value) {
    const raw = String(value || "binance").trim().toLowerCase();
    return ALIASES[raw] || raw;
}

function getRegistryEntry(exchange) {
    const id = normalizeExchangeId(exchange);
    return REGISTRY[id] || null;
}

function listRegisteredExchanges() {
    return Object.keys(REGISTRY);
}

function defaultCapabilities(exchange) {
    const entry = getRegistryEntry(exchange);
    return { ...(entry?.supports || READ_ONLY) };
}

function displayNameOf(exchange) {
    return getRegistryEntry(exchange)?.displayName || String(exchange || "unknown");
}

module.exports = {
    REGISTRY,
    READ_ONLY,
    BINANCE_FULL,
    normalizeExchangeId,
    getRegistryEntry,
    listRegisteredExchanges,
    defaultCapabilities,
    displayNameOf,
};
