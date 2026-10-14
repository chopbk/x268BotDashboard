/**
 * Bybit V5 Linear — Phase 1 read-only (snapshot).
 * Mutation capability = false cho đến khi adapter test pass.
 */

const crypto = require("crypto");
const { BaseExchangeAdapter } = require("./base-adapter");
const { READ_ONLY } = require("./registry");
const { canonicalizePosition, canonicalizeOrder, buildSnapshotEnvelope, toNum } = require("./normalizers");
const { exchangeError, fromFetchFailure, classifyHttpStatus, sanitizeErrorMessage } = require("./errors");
const { enqueueExchangeRest } = require("./rate-limiters");

const HOST = "https://api.bybit.com";
const RECV_WINDOW = "5000";

class BybitLinearAdapter extends BaseExchangeAdapter {
    constructor(opts = {}) {
        super({ ...opts, exchange: "bybit" });
        this._caps = { ...READ_ONLY, snapshot: true };
        this.baseUrl = opts.baseUrl || HOST;
    }

    sign(timestamp, payload) {
        return crypto
            .createHmac("sha256", this.apiSecret)
            .update(`${timestamp}${this.apiKey}${RECV_WINDOW}${payload}`)
            .digest("hex");
    }

    async request(method, path, params = {}) {
        const timestamp = String(Date.now());
        const upper = String(method || "GET").toUpperCase();
        let url = `${this.baseUrl}${path}`;
        const headers = {
            "X-BAPI-API-KEY": this.apiKey,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": RECV_WINDOW,
            "X-BAPI-SIGN-TYPE": "2",
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            let body;
            if (upper === "GET") {
                const query = Object.keys(params)
                    .filter((key) => params[key] != null && params[key] !== "")
                    .sort()
                    .map((key) => `${key}=${params[key]}`)
                    .join("&");
                if (query) url += `?${query}`;
                headers["X-BAPI-SIGN"] = this.sign(timestamp, query);
            } else {
                body = JSON.stringify(params);
                headers["X-BAPI-SIGN"] = this.sign(timestamp, body);
                headers["Content-Type"] = "application/json";
            }

            const res = await this.fetchImpl(url, {
                method: upper,
                headers,
                body: upper === "GET" ? undefined : body,
                signal: controller.signal,
            });
            const json = await res.json().catch(() => ({}));
            const retCode = json?.retCode;
            if (!res.ok || (retCode != null && Number(retCode) !== 0)) {
                const msg = sanitizeErrorMessage(json?.retMsg || `Bybit HTTP ${res.status}`);
                const category = Number(retCode) === 10006 || res.status === 429
                    ? "rate_limit"
                    : classifyHttpStatus(res.status, msg);
                const err = exchangeError(category, msg, {
                    exchange: "bybit",
                    status: res.status === 200 ? 400 : res.status,
                    code: retCode,
                });
                const retry = res.headers?.get?.("retry-after");
                if (retry) err.retryAfterMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : 0;
                throw err;
            }
            return json;
        } catch (error) {
            throw fromFetchFailure(error, "bybit");
        } finally {
            clearTimeout(timer);
        }
    }

    queued(fn, weight = 1) {
        return enqueueExchangeRest("bybit", this.account, fn, { weight });
    }

    mapSide(side) {
        const raw = String(side || "").toLowerCase();
        if (raw === "buy" || raw === "long") return "LONG";
        if (raw === "sell" || raw === "short") return "SHORT";
        return "BOTH";
    }

    normalizePosition(row) {
        const side = this.mapSide(row.side);
        const size = Math.abs(toNum(row.size));
        const positionIdx = row.positionIdx != null && row.positionIdx !== "" ? Number(row.positionIdx) : null;
        return canonicalizePosition({
            account: this.account,
            exchange: "bybit",
            symbol: row.symbol,
            instrumentId: row.symbol,
            side,
            positionSide: side,
            positionIdx,
            positionAmt: side === "SHORT" ? -size : size,
            quantity: size,
            quantityUnit: "base",
            baseQuantity: String(size),
            notional: row.positionValue != null ? String(row.positionValue) : null,
            entryPrice: row.avgPrice,
            markPrice: row.markPrice,
            unrealizedPnl: row.unrealisedPnl,
            leverage: row.leverage,
            marginMode: row.tradeMode === 1 || String(row.marginMode || "").toLowerCase() === "isolated" ? "isolated" : "cross",
            liquidationPrice: row.liqPrice,
            updateTime: row.updatedTime,
            source: "rest",
        });
    }

    normalizeOrder(row, kind) {
        return canonicalizeOrder({
            account: this.account,
            exchange: "bybit",
            symbol: row.symbol,
            instrumentId: row.symbol,
            side: String(row.side || "").toUpperCase() === "BUY" ? "BUY" : "SELL",
            positionSide: this.mapSide(row.side),
            positionIdx: row.positionIdx,
            orderId: row.orderId || row.stopOrderId,
            type: row.orderType || row.stopOrderType,
            price: row.price,
            triggerPrice: row.triggerPrice,
            triggerSource: String(row.triggerBy || "").toLowerCase().includes("mark") ? "mark"
                : String(row.triggerBy || "").toLowerCase().includes("index") ? "index" : "last",
            quantity: row.qty,
            quantityUnit: "base",
            reduceOnly: row.reduceOnly === true || row.reduceOnly === "true",
            closeOnTrigger: row.closeOnTrigger === true,
            status: row.orderStatus || row.stopOrderStatus,
            protectionMode: kind === "conditional" ? "conditional-order" : null,
            source: "rest",
        }, kind);
    }

    async getSnapshot({ liveOnly = true } = {}) {
        void liveOnly;
        try {
            const posRes = await this.queued(
                () => this.request("GET", "/v5/position/list", { category: "linear", settleCoin: "USDT" }),
                5
            );
            const posList = Array.isArray(posRes?.result?.list) ? posRes.result.list : [];
            const positions = posList
                .filter((row) => Math.abs(toNum(row.size)) > 0)
                .map((row) => this.normalizePosition(row));

            const openRes = await this.queued(
                () => this.request("GET", "/v5/order/realtime", { category: "linear", settleCoin: "USDT" }),
                1
            );
            const openList = Array.isArray(openRes?.result?.list) ? openRes.result.list : [];
            const openOrders = openList.map((row) => this.normalizeOrder(row, "regular"));

            let conditionalOrders = [];
            try {
                const stopRes = await this.queued(
                    () => this.request("GET", "/v5/order/realtime", {
                        category: "linear",
                        settleCoin: "USDT",
                        orderFilter: "StopOrder",
                    }),
                    1
                );
                const stopList = Array.isArray(stopRes?.result?.list) ? stopRes.result.list : [];
                conditionalOrders = stopList.map((row) => this.normalizeOrder(row, "conditional"));
            } catch (error) {
                if (error.status === 429) throw error;
                console.error("[BybitLinearAdapter.getSnapshot] stop orders", error.message);
            }

            const envelope = buildSnapshotEnvelope({
                account: this.account,
                exchange: "bybit",
                positions,
                openOrders,
                conditionalOrders,
                source: "rest",
            });
            return { ...envelope, algoOrders: conditionalOrders };
        } catch (error) {
            throw fromFetchFailure(error, "bybit");
        }
    }

    async getMarkPrices(instruments = []) {
        const out = {};
        const symbols = (instruments || []).map((id) => String(id || "").toUpperCase()).filter(Boolean);
        if (!symbols.length) return out;
        for (const symbol of symbols.slice(0, 20)) {
            try {
                const res = await this.queued(
                    () => this.request("GET", "/v5/market/tickers", { category: "linear", symbol }),
                    1
                );
                const row = res?.result?.list?.[0];
                if (row?.markPrice != null) out[symbol] = toNum(row.markPrice);
            } catch (error) {
                console.error("[BybitLinearAdapter.getMarkPrices]", symbol, error.message);
            }
        }
        return out;
    }

    async getInstrument(instrumentId) {
        const symbol = String(instrumentId || "").toUpperCase();
        if (!symbol) return null;
        const res = await this.queued(
            () => this.request("GET", "/v5/market/instruments-info", { category: "linear", symbol }),
            1
        );
        const row = res?.result?.list?.[0];
        if (!row) return null;
        return {
            symbol: row.symbol,
            instrumentId: row.symbol,
            tickSize: row.priceFilter?.tickSize,
            stepSize: row.lotSizeFilter?.qtyStep,
            minQty: row.lotSizeFilter?.minOrderQty,
            exchange: "bybit",
        };
    }

    /** Hedge mode: reject mutation nếu positionIdx ambiguous. */
    assertPositionIdx(input) {
        if (input?.positionIdx == null || input.positionIdx === "") {
            throw exchangeError("validation", "Bybit hedge mode cần positionIdx rõ ràng", {
                exchange: "bybit",
                code: "position_idx_ambiguous",
            });
        }
    }
}

module.exports = { BybitLinearAdapter };
