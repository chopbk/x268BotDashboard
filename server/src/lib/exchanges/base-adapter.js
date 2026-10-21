/**
 * Contract tối thiểu cho mọi futures adapter.
 * Subclass override method cần dùng; mặc định throw unsupported.
 */

const { defaultCapabilities, displayNameOf, normalizeExchangeId } = require("./registry");
const { unsupportedAction } = require("./errors");

class BaseExchangeAdapter {
    /**
     * @param {{ account: string, exchange: string, apiKey?: string, apiSecret?: string, password?: string, fetchImpl?: typeof fetch }} opts
     */
    constructor(opts = {}) {
        this.account = String(opts.account || "").trim();
        this.exchange = normalizeExchangeId(opts.exchange);
        this.displayName = displayNameOf(this.exchange);
        this.apiKey = opts.apiKey || "";
        this.apiSecret = opts.apiSecret || "";
        this.password = opts.password || "";
        this.fetchImpl = opts.fetchImpl || fetch;
        this._caps = { ...defaultCapabilities(this.exchange) };
    }

    capabilities() {
        return { ...this._caps };
    }

    requireCapability(action) {
        const caps = this.capabilities();
        if (!caps[action]) throw unsupportedAction(this.displayName, action);
    }

    async getSnapshot() {
        throw unsupportedAction(this.displayName, "snapshot");
    }

    async getHistoryDetails() {
        throw unsupportedAction(this.displayName, "history");
    }

    async fetchPositionHistory() {
        throw unsupportedAction(this.displayName, "history");
    }

    async getBalance() {
        throw unsupportedAction(this.displayName, "snapshot");
    }

    async getMarkPrices() {
        return {};
    }

    async getInstrument() {
        return null;
    }

    async openPosition() {
        this.requireCapability("open");
    }

    async closePosition() {
        this.requireCapability("close");
    }

    async reversePosition() {
        this.requireCapability("reverse");
    }

    async createOrder(input = {}) {
        const kind = String(input.orderKind || "regular").toLowerCase();
        this.requireCapability(kind === "conditional" ? "conditionalOrder" : "regularOrder");
    }

    async cancelOrder(input = {}) {
        const kind = String(input.orderKind || input.kind || "regular").toLowerCase();
        this.requireCapability(kind === "conditional" || kind === "algo" ? "conditionalOrder" : "regularOrder");
    }

    async replaceOrder() {
        this.requireCapability("regularOrder");
    }

    async setTpsl(input = {}) {
        const trail = input?.trailing;
        if (trail?.enabled !== false && trail?.callbackRate != null) this.requireCapability("trailing");
        else this.requireCapability("tpsl");
    }

    async cancelTpsl() {
        this.requireCapability("tpsl");
    }
}

module.exports = { BaseExchangeAdapter };
