/**
 * Aster Futures — Phase 1 read-only.
 * Dùng endpoint fapi-style trên host Aster cho snapshot; không bật mutation
 * trừ khi có test chứng minh tương thích đầy đủ với Binance order/conditional.
 */

const crypto = require("crypto");
const { BaseExchangeAdapter } = require("./base-adapter");
const { READ_ONLY } = require("./registry");
const { canonicalizePosition, canonicalizeOrder, buildSnapshotEnvelope, toNum } = require("./normalizers");
const { exchangeError, fromFetchFailure, classifyHttpStatus, sanitizeErrorMessage } = require("./errors");
const { enqueueExchangeRest } = require("./rate-limiters");

const HOST = "https://fapi.asterdex.com";

class AsterFuturesAdapter extends BaseExchangeAdapter {
    constructor(opts = {}) {
        super({ ...opts, exchange: "aster" });
        // Snapshot only — mutation capability false cho đến khi verify.
        this._caps = { ...READ_ONLY, snapshot: true };
        this.baseUrl = opts.baseUrl || HOST;
    }

    signQuery(params) {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value != null && value !== "") query.set(key, String(value));
        }
        query.set("recvWindow", "5000");
        query.set("timestamp", String(Date.now()));
        const payload = query.toString();
        const signature = crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
        return `${payload}&signature=${signature}`;
    }

    async request(method, path, params = {}) {
        const upper = String(method || "GET").toUpperCase();
        const query = this.signQuery(params);
        const url = `${this.baseUrl}${path}?${query}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await this.fetchImpl(url, {
                method: upper,
                headers: { "X-MBX-APIKEY": this.apiKey },
                signal: controller.signal,
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || (body && body.code && body.msg)) {
                const msg = sanitizeErrorMessage(body?.msg || `Aster HTTP ${res.status}`);
                const category = res.status === 418 || res.status === 429 || body?.code === -1003
                    ? "rate_limit"
                    : classifyHttpStatus(res.status, msg);
                const err = exchangeError(category, msg, {
                    exchange: "aster",
                    status: res.status >= 400 ? res.status : 400,
                    code: body?.code,
                });
                const retry = res.headers?.get?.("retry-after");
                if (retry) err.retryAfterMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : 0;
                throw err;
            }
            return body;
        } catch (error) {
            throw fromFetchFailure(error, "aster");
        } finally {
            clearTimeout(timer);
        }
    }

    queued(fn, weight = 1) {
        return enqueueExchangeRest("aster", this.account, fn, { weight });
    }

    normalizePosition(row) {
        const mode = String(row.positionSide || "BOTH").toUpperCase();
        const amt = toNum(row.positionAmt);
        const side = mode === "LONG" || mode === "SHORT" ? mode : (amt < 0 ? "SHORT" : "LONG");
        return canonicalizePosition({
            account: this.account,
            exchange: "aster",
            symbol: row.symbol,
            instrumentId: row.symbol,
            side,
            positionSide: mode,
            positionAmt: row.positionAmt,
            quantity: Math.abs(amt),
            quantityUnit: "base",
            baseQuantity: String(Math.abs(amt)),
            entryPrice: row.entryPrice,
            markPrice: row.markPrice,
            unrealizedPnl: row.unRealizedProfit,
            leverage: row.leverage,
            marginMode: row.marginType,
            liquidationPrice: row.liquidationPrice,
            updateTime: row.updateTime,
            source: "rest",
        });
    }

    normalizeOrder(row, kind) {
        return canonicalizeOrder({
            account: this.account,
            exchange: "aster",
            symbol: row.symbol,
            instrumentId: row.symbol,
            side: row.side,
            positionSide: row.positionSide,
            orderId: row.orderId || row.algoId,
            algoId: row.algoId,
            type: row.type || row.orderType,
            price: row.price,
            stopPrice: row.stopPrice || row.triggerPrice,
            quantity: row.origQty || row.quantity,
            quantityUnit: "base",
            reduceOnly: row.reduceOnly,
            closePosition: row.closePosition,
            status: row.status || row.algoStatus,
            workingType: row.workingType,
            protectionMode: kind === "conditional" ? "conditional-order" : null,
            source: "rest",
        }, kind);
    }

    async getSnapshot({ liveOnly = true } = {}) {
        void liveOnly;
        try {
            const positionsRaw = await this.queued(() => this.request("GET", "/fapi/v2/positionRisk", {}), 5);
            if (!Array.isArray(positionsRaw)) {
                throw exchangeError("unknown_result", "Sổ vị thế Aster không hợp lệ", { exchange: "aster" });
            }
            const positions = positionsRaw
                .filter((row) => Math.abs(toNum(row.positionAmt)) > 0)
                .map((row) => this.normalizePosition(row));

            const openRaw = await this.queued(() => this.request("GET", "/fapi/v1/openOrders", {}), 1);
            const openOrders = (Array.isArray(openRaw) ? openRaw : []).map((row) => this.normalizeOrder(row, "regular"));

            let conditionalOrders = [];
            try {
                const algoRaw = await this.queued(() => this.request("GET", "/fapi/v1/openAlgoOrders", {}), 1);
                const list = Array.isArray(algoRaw) ? algoRaw : algoRaw?.orders || [];
                conditionalOrders = list.map((row) => this.normalizeOrder(row, "conditional"));
            } catch (error) {
                if (error.status === 429) throw error;
                // Aster có thể chưa hỗ trợ openAlgoOrders — snapshot vẫn OK không có conditional.
                console.warn("[AsterFuturesAdapter.getSnapshot] conditional unavailable:", error.message);
            }

            const envelope = buildSnapshotEnvelope({
                account: this.account,
                exchange: "aster",
                positions,
                openOrders,
                conditionalOrders,
                source: "rest",
            });
            return { ...envelope, algoOrders: conditionalOrders };
        } catch (error) {
            throw fromFetchFailure(error, "aster");
        }
    }

    async getMarkPrices(instruments = []) {
        const map = {};
        try {
            const rows = await this.fetchImpl(`${this.baseUrl}/fapi/v1/ticker/price`).then((r) => r.json());
            for (const row of Array.isArray(rows) ? rows : []) {
                map[String(row.symbol || "").toUpperCase()] = toNum(row.price);
            }
        } catch (error) {
            console.error("[AsterFuturesAdapter.getMarkPrices]", error.message);
        }
        if (!instruments?.length) return map;
        const out = {};
        for (const id of instruments) {
            const key = String(id || "").toUpperCase();
            if (map[key] != null) out[key] = map[key];
        }
        return out;
    }
}

module.exports = { AsterFuturesAdapter };
