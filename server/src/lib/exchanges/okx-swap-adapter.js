/**
 * OKX Swap (`exchange: "okex"`) — Phase 1 read-only.
 * Giữ instId đầy đủ (BTC-USDT-SWAP). Quantity là contract, không phải base.
 * Password trong User API = passphrase — không log/return.
 */

const crypto = require("crypto");
const { BaseExchangeAdapter } = require("./base-adapter");
const { READ_ONLY } = require("./registry");
const {
    canonicalizePosition,
    canonicalizeOrder,
    buildSnapshotEnvelope,
    toNum,
    roundContractsDown,
} = require("./normalizers");
const { exchangeError, fromFetchFailure, classifyHttpStatus, sanitizeErrorMessage } = require("./errors");
const { enqueueExchangeRest } = require("./rate-limiters");

const HOST = "https://www.okx.com";

class OkxSwapAdapter extends BaseExchangeAdapter {
    constructor(opts = {}) {
        super({ ...opts, exchange: "okex" });
        this._caps = { ...READ_ONLY, snapshot: true };
        this.baseUrl = opts.baseUrl || HOST;
        this.passphrase = opts.password || opts.passphrase || "";
        this._instrumentCache = new Map();
    }

    sign(timestamp, method, pathWithQuery, body = "") {
        const prehash = `${timestamp}${String(method || "GET").toUpperCase()}${pathWithQuery}${body}`;
        return crypto.createHmac("sha256", this.apiSecret).update(prehash).digest("base64");
    }

    async request(method, path, params = null) {
        if (!this.passphrase) {
            throw exchangeError("credential", "OKX cần passphrase (password) trên User API", {
                exchange: "okex",
                code: "missing_passphrase",
            });
        }
        const upper = String(method || "GET").toUpperCase();
        let pathWithQuery = path;
        let body = "";
        if (upper === "GET" && params && Object.keys(params).length) {
            const qs = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value != null && value !== "") qs.set(key, String(value));
            }
            pathWithQuery = `${path}?${qs.toString()}`;
        } else if (params && upper !== "GET") {
            body = JSON.stringify(params);
        }

        const timestamp = new Date().toISOString();
        const headers = {
            "OK-ACCESS-KEY": this.apiKey,
            "OK-ACCESS-SIGN": this.sign(timestamp, upper, pathWithQuery, body),
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": this.passphrase,
            "Content-Type": "application/json",
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await this.fetchImpl(`${this.baseUrl}${pathWithQuery}`, {
                method: upper,
                headers,
                body: upper === "GET" ? undefined : body,
                signal: controller.signal,
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || (json?.code != null && String(json.code) !== "0")) {
                const msg = sanitizeErrorMessage(json?.msg || `OKX HTTP ${res.status}`);
                const category = res.status === 429 ? "rate_limit" : classifyHttpStatus(res.status, msg);
                throw exchangeError(category, msg, {
                    exchange: "okex",
                    status: res.status === 200 ? 400 : res.status,
                    code: json?.code,
                });
            }
            return json;
        } catch (error) {
            throw fromFetchFailure(error, "okex");
        } finally {
            clearTimeout(timer);
        }
    }

    queued(fn, weight = 1) {
        return enqueueExchangeRest("okex", this.account, fn, { weight });
    }

    mapPosSide(posSide, pos) {
        const raw = String(posSide || "").toLowerCase();
        if (raw === "long") return "LONG";
        if (raw === "short") return "SHORT";
        if (raw === "net") {
            const amt = toNum(pos);
            if (amt < 0) return "SHORT";
            if (amt > 0) return "LONG";
        }
        return "BOTH";
    }

    async getInstrument(instrumentId) {
        const instId = String(instrumentId || "").trim();
        if (!instId) return null;
        if (this._instrumentCache.has(instId)) return this._instrumentCache.get(instId);

        const res = await this.queued(
            () => this.request("GET", "/api/v5/public/instruments", { instType: "SWAP", instId }),
            1
        );
        const row = Array.isArray(res?.data) ? res.data[0] : null;
        if (!row) return null;
        const meta = {
            symbol: row.instId,
            instrumentId: row.instId,
            instId: row.instId,
            ctVal: toNum(row.ctVal) || 1,
            ctMult: toNum(row.ctMult) || 1,
            tickSize: row.tickSz,
            stepSize: row.lotSz || "1",
            minQty: row.minSz,
            quantityUnit: "contracts",
            exchange: "okex",
        };
        this._instrumentCache.set(instId, meta);
        return meta;
    }

    /**
     * Convert contract count → base quantity bằng ctVal * ctMult.
     */
    contractsToBase(contracts, meta) {
        const ctVal = toNum(meta?.ctVal) || 1;
        const ctMult = toNum(meta?.ctMult) || 1;
        const base = Math.abs(toNum(contracts)) * ctVal * ctMult;
        return Number.isFinite(base) ? base : null;
    }

    /**
     * Partial close: round down theo lotSz (contract step).
     */
    roundCloseContracts(rawContracts, percent, meta) {
        const total = Math.abs(toNum(rawContracts));
        const pct = toNum(percent);
        if (!(total > 0) || !(pct > 0)) return null;
        const want = total * (pct / 100);
        const step = meta?.stepSize || meta?.lotSz || "1";
        return roundContractsDown(want, step);
    }

    async normalizePosition(row) {
        const instId = String(row.instId || "").trim();
        const contracts = Math.abs(toNum(row.pos));
        const side = this.mapPosSide(row.posSide, row.pos);
        let meta = null;
        try {
            meta = await this.getInstrument(instId);
        } catch (error) {
            console.warn("[OkxSwapAdapter.normalizePosition] instrument", instId, error.message);
        }
        const baseQuantity = this.contractsToBase(contracts, meta);
        const mark = toNum(row.markPx || row.last);
        const notional = baseQuantity != null && mark > 0 ? baseQuantity * mark : null;

        return canonicalizePosition({
            account: this.account,
            exchange: "okex",
            // Không tự thêm USDT — giữ instId.
            symbol: instId,
            instrumentId: instId,
            side,
            positionSide: side === "LONG" || side === "SHORT" ? side : "BOTH",
            positionAmt: side === "SHORT" ? -contracts : contracts,
            quantity: contracts,
            quantityUnit: "contracts",
            baseQuantity: baseQuantity != null ? String(baseQuantity) : null,
            notional: notional != null ? String(notional) : null,
            entryPrice: row.avgPx,
            markPrice: row.markPx || row.last,
            unrealizedPnl: row.upl,
            leverage: row.lever,
            marginMode: row.mgnMode,
            liquidationPrice: row.liqPx,
            updateTime: row.uTime,
            source: "rest",
        });
    }

    normalizeOrder(row, kind) {
        const instId = String(row.instId || "").trim();
        return canonicalizeOrder({
            account: this.account,
            exchange: "okex",
            symbol: instId,
            instrumentId: instId,
            side: String(row.side || "").toUpperCase(),
            positionSide: this.mapPosSide(row.posSide, row.sz),
            orderId: row.ordId || row.algoId,
            algoId: row.algoId,
            type: row.ordType || row.orderType,
            price: row.px,
            triggerPrice: row.triggerPx || row.slTriggerPx || row.tpTriggerPx,
            quantity: row.sz,
            quantityUnit: "contracts",
            reduceOnly: row.reduceOnly === true || row.reduceOnly === "true",
            status: row.state,
            protectionMode: kind === "conditional" ? "conditional-order" : null,
            source: "rest",
        }, kind);
    }

    async getSnapshot({ liveOnly = true } = {}) {
        void liveOnly;
        try {
            const posRes = await this.queued(
                () => this.request("GET", "/api/v5/account/positions", { instType: "SWAP" }),
                5
            );
            const posList = Array.isArray(posRes?.data) ? posRes.data : [];
            const positions = [];
            for (const row of posList) {
                if (!(Math.abs(toNum(row.pos)) > 0)) continue;
                positions.push(await this.normalizePosition(row));
            }

            const openRes = await this.queued(
                () => this.request("GET", "/api/v5/trade/orders-pending", { instType: "SWAP" }),
                1
            );
            const openOrders = (Array.isArray(openRes?.data) ? openRes.data : [])
                .map((row) => this.normalizeOrder(row, "regular"));

            let conditionalOrders = [];
            try {
                const algoRes = await this.queued(
                    () => this.request("GET", "/api/v5/trade/orders-algo-pending", {
                        instType: "SWAP",
                        ordType: "conditional",
                    }),
                    1
                );
                conditionalOrders = (Array.isArray(algoRes?.data) ? algoRes.data : [])
                    .map((row) => this.normalizeOrder(row, "conditional"));
            } catch (error) {
                if (error.status === 429) throw error;
                console.warn("[OkxSwapAdapter.getSnapshot] algo pending:", error.message);
            }

            const envelope = buildSnapshotEnvelope({
                account: this.account,
                exchange: "okex",
                positions,
                openOrders,
                conditionalOrders,
                source: "rest",
            });
            return { ...envelope, algoOrders: conditionalOrders };
        } catch (error) {
            throw fromFetchFailure(error, "okex");
        }
    }

    async getMarkPrices(instruments = []) {
        const out = {};
        for (const id of (instruments || []).slice(0, 20)) {
            const instId = String(id || "").trim();
            if (!instId) continue;
            try {
                const res = await this.queued(
                    () => this.request("GET", "/api/v5/market/ticker", { instId }),
                    1
                );
                const row = res?.data?.[0];
                if (row?.last != null) out[instId] = toNum(row.last);
            } catch (error) {
                console.error("[OkxSwapAdapter.getMarkPrices]", instId, error.message);
            }
        }
        return out;
    }

    async getBalance() {
        const res = await this.queued(() => this.request("GET", "/api/v5/account/balance", {}), 5);
        return Array.isArray(res?.data) ? res.data : [];
    }
}

module.exports = { OkxSwapAdapter };
