/**
 * Binance USD-M Futures adapter — wrap createBinanceFutures, giữ hành vi cũ.
 */

const { createBinanceFutures, toNum } = require("../binance-futures");
const { findSymbolInfo, floorToStep, roundToTick } = require("../symbol-info");
const { BaseExchangeAdapter } = require("./base-adapter");
const { BINANCE_FULL } = require("./registry");
const { canonicalizePosition, canonicalizeOrder, buildSnapshotEnvelope } = require("./normalizers");
const { exchangeError, fromFetchFailure } = require("./errors");
const { enqueueExchangeRest } = require("./rate-limiters");
const { httpError } = require("../http");

const ALGO_ORDER_TYPES = new Set([
    "STOP",
    "STOP_MARKET",
    "TAKE_PROFIT",
    "TAKE_PROFIT_MARKET",
    "TRAILING_STOP_MARKET",
]);

const DAY_MS = 24 * 60 * 60 * 1000;
/** userTrades / income: khung truy vấn an toàn ~7 ngày. */
const HISTORY_CHUNK_MS = 7 * DAY_MS;
/** Gộp các lần REALIZED_PNL cùng symbol trong burst đóng. */
const REALIZED_GROUP_MS = 5 * 60 * 1000;
const QTY_EPS = 1e-8;
const MAX_HISTORY_SYMBOLS = 40;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function historyRowKey(row) {
    return [
        String(row.symbol || "").toUpperCase(),
        String(row.positionSide || ""),
        String(row.time || ""),
        String(row.realizedPnl ?? ""),
        String(row.closedVolume ?? ""),
    ].join("|");
}

/**
 * Binance không có GET /fapi/v1/positionHistory (404).
 * Gộp income REALIZED_PNL cùng symbol trong cửa sổ ngắn → gần với một lần đóng.
 */
function groupRealizedPnlIncomes(rows) {
    const sorted = [...(rows || [])]
        .filter((row) => String(row?.symbol || "").trim())
        .filter((row) => {
            const kind = String(row?.incomeType || "REALIZED_PNL").toUpperCase();
            return !row?.incomeType || kind === "REALIZED_PNL";
        })
        .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    const groups = [];
    for (const row of sorted) {
        const symbol = String(row.symbol || "").toUpperCase();
        const time = Number(row.time) || 0;
        const income = Number(row.income);
        if (!Number.isFinite(income)) continue;
        const last = groups[groups.length - 1];
        if (last && last.symbol === symbol && time - last.time <= REALIZED_GROUP_MS) {
            last.realizedPnl += income;
            last.time = time;
            last.count += 1;
            continue;
        }
        groups.push({ symbol, realizedPnl: income, time, count: 1 });
    }
    return groups.map((group) => ({
        symbol: group.symbol,
        positionSide: "BOTH",
        realizedPnl: Math.round(group.realizedPnl * 1e8) / 1e8,
        commission: null,
        fundingFee: null,
        closedVolume: null,
        entryPrice: null,
        avgClosePrice: null,
        time: group.time,
        source: "income_realized_pnl",
    }));
}

function tradeQtyDelta(trade) {
    const qty = Math.abs(Number(trade?.qty) || 0);
    if (!(qty > 0)) return 0;
    const orderSide = String(trade?.side || "").toUpperCase();
    const positionSide = String(trade?.positionSide || "BOTH").toUpperCase();
    if (positionSide === "LONG") return orderSide === "BUY" ? qty : -qty;
    if (positionSide === "SHORT") return orderSide === "SELL" ? qty : -qty;
    return orderSide === "BUY" ? qty : -qty;
}

/**
 * Tái tạo vị thế đã đóng (net qty về 0) từ userTrades — gần menu Position History trên Binance.
 */
function reconstructClosedFromTrades(trades) {
    const byKey = new Map();
    for (const trade of trades || []) {
        const symbol = String(trade?.symbol || "").toUpperCase();
        if (!symbol) continue;
        const positionSide = String(trade?.positionSide || "BOTH").toUpperCase();
        const key = `${symbol}|${positionSide}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(trade);
    }
    const closed = [];
    for (const [key, list] of byKey) {
        const [symbol, positionSide] = key.split("|");
        const ordered = [...list].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0)
            || (Number(a.id) || 0) - (Number(b.id) || 0));
        let net = 0;
        let cycle = null;
        for (const trade of ordered) {
            const delta = tradeQtyDelta(trade);
            if (!delta) continue;
            const price = Number(trade.price) || 0;
            const absQty = Math.abs(delta);
            const pnl = Number(trade.realizedPnl);
            const fee = Number(trade.commission);
            if (Math.abs(net) < QTY_EPS) {
                cycle = {
                    openTime: trade.time,
                    entryNotional: 0,
                    entryQty: 0,
                    closeNotional: 0,
                    closeQty: 0,
                    realized: 0,
                    commission: 0,
                };
            }
            if (!cycle) continue;
            const prev = net;
            const next = prev + delta;
            if (Math.abs(next) > Math.abs(prev) + QTY_EPS) {
                cycle.entryNotional += price * absQty;
                cycle.entryQty += absQty;
            } else {
                cycle.closeNotional += price * absQty;
                cycle.closeQty += absQty;
            }
            if (Number.isFinite(pnl)) cycle.realized += pnl;
            if (Number.isFinite(fee)) cycle.commission += fee;
            net = next;
            if (Math.abs(prev) > QTY_EPS && Math.abs(net) <= QTY_EPS) {
                closed.push({
                    symbol,
                    positionSide,
                    realizedPnl: Math.round(cycle.realized * 1e8) / 1e8,
                    commission: Math.round(cycle.commission * 1e8) / 1e8,
                    fundingFee: null,
                    closedVolume: cycle.closeQty > 0
                        ? Math.round(cycle.closeQty * 1e8) / 1e8
                        : (cycle.entryQty > 0 ? Math.round(cycle.entryQty * 1e8) / 1e8 : null),
                    entryPrice: cycle.entryQty > 0 ? cycle.entryNotional / cycle.entryQty : null,
                    avgClosePrice: cycle.closeQty > 0 ? cycle.closeNotional / cycle.closeQty : null,
                    time: Number(trade.time) || 0,
                    openTime: cycle.openTime || null,
                    source: "user_trades",
                });
                net = 0;
                cycle = null;
            }
        }
    }
    return closed;
}

class BinanceFuturesAdapter extends BaseExchangeAdapter {
    constructor(opts = {}) {
        super({ ...opts, exchange: "binance" });
        this._caps = { ...BINANCE_FULL };
        this.client = createBinanceFutures({
            apiKey: this.apiKey,
            apiSecret: this.apiSecret,
            fetchImpl: this.fetchImpl,
        });
    }

    async queued(fn, weight = 1) {
        return enqueueExchangeRest("binance", this.account, fn, { weight });
    }

    async getSnapshot({ liveOnly = true } = {}) {
        try {
            const positions = await this.queued(() => this.client.signedGet("/fapi/v2/positionRisk", {}), 5);
            if (!Array.isArray(positions)) throw exchangeError("unknown_result", "Sổ vị thế sàn không hợp lệ", { exchange: "binance" });
            const openPositions = positions
                .filter((row) => Math.abs(toNum(row.positionAmt)) > 0)
                .map((row) => canonicalizePosition({
                    ...row,
                    account: this.account,
                    exchange: "binance",
                    instrumentId: row.symbol,
                    symbol: row.symbol,
                    side: row.positionSide === "LONG" || row.positionSide === "SHORT"
                        ? row.positionSide
                        : (toNum(row.positionAmt) < 0 ? "SHORT" : "LONG"),
                    quantity: Math.abs(toNum(row.positionAmt)),
                    quantityUnit: "base",
                    baseQuantity: String(Math.abs(toNum(row.positionAmt))),
                    unrealizedPnl: row.unRealizedProfit,
                    marginMode: row.marginType,
                    source: "rest",
                }));

            const openOrdersRaw = await this.queued(() => this.client.signedGet("/fapi/v1/openOrders", {}), 1);
            const openOrders = (Array.isArray(openOrdersRaw) ? openOrdersRaw : []).map((row) => canonicalizeOrder({
                ...row,
                account: this.account,
                exchange: "binance",
                instrumentId: row.symbol,
                quantityUnit: "base",
                source: "rest",
            }, "regular"));

            let algoRaw = [];
            try {
                algoRaw = await this.queued(() => this.client.signedGet("/fapi/v1/openAlgoOrders", {}), 1);
            } catch (error) {
                if (error.status === 429) throw error;
                console.error("[BinanceFuturesAdapter.getSnapshot]", error.message);
                algoRaw = [];
            }
            const algoList = Array.isArray(algoRaw) ? algoRaw : algoRaw?.orders || [];
            const conditionalOrders = algoList.map((row) => canonicalizeOrder({
                ...row,
                account: this.account,
                exchange: "binance",
                instrumentId: row.symbol,
                orderId: row.algoId || row.orderId,
                algoId: row.algoId,
                quantityUnit: "base",
                protectionMode: "conditional-order",
                source: "rest",
            }, "conditional"));

            const envelope = buildSnapshotEnvelope({
                account: this.account,
                exchange: "binance",
                positions: openPositions,
                openOrders,
                conditionalOrders,
                source: "rest",
            });

            // Compat: callers cũ đọc positions/openOrders/algoOrders raw-ish
            if (liveOnly) {
                return {
                    ...envelope,
                    positions: openPositions,
                    openOrders,
                    algoOrders: conditionalOrders,
                    conditionalOrders,
                };
            }

            const details = await this.getHistoryDetails({ positions: openPositions });
            return { ...envelope, ...details, algoOrders: conditionalOrders };
        } catch (error) {
            throw fromFetchFailure(error, "binance");
        }
    }

    /**
     * Income theo loại — chia cửa sổ 7 ngày + phân trang limit 1000.
     * (API public không có /fapi/v1/positionHistory — endpoint đó 404.)
     */
    async fetchIncomeRange({ startTime, endTime, incomeType = null } = {}) {
        const end = Number.isFinite(Number(endTime)) ? Number(endTime) : Date.now();
        const start = Number.isFinite(Number(startTime)) ? Number(startTime) : end - 3 * DAY_MS;
        if (!(end >= start)) return [];
        const out = [];
        for (let cursor = start; cursor < end; cursor += HISTORY_CHUNK_MS) {
            const chunkEnd = Math.min(cursor + HISTORY_CHUNK_MS, end);
            let pageStart = cursor;
            while (pageStart <= chunkEnd) {
                try {
                    const params = { startTime: pageStart, endTime: chunkEnd, limit: 1000 };
                    if (incomeType) params.incomeType = incomeType;
                    const batch = await this.queued(
                        () => this.client.signedGet("/fapi/v1/income", params),
                        30
                    );
                    if (!Array.isArray(batch) || !batch.length) break;
                    out.push(...batch);
                    if (batch.length < 1000) break;
                    const last = Number(batch[batch.length - 1].time) || pageStart;
                    const next = last + 1;
                    if (next <= pageStart) break;
                    pageStart = next;
                } catch (error) {
                    if (error.status === 429) throw error;
                    console.error("[BinanceFuturesAdapter.fetchIncomeRange]", error.message);
                    break;
                }
                await sleep(150);
            }
            if (chunkEnd < end) await sleep(150);
        }
        return out;
    }

    async fetchUserTradesRange(symbol, startTime, endTime) {
        const sym = String(symbol || "").toUpperCase();
        if (!sym) return [];
        const end = Number.isFinite(Number(endTime)) ? Number(endTime) : Date.now();
        const start = Number.isFinite(Number(startTime)) ? Number(startTime) : end - 3 * DAY_MS;
        const out = [];
        for (let cursor = start; cursor < end; cursor += HISTORY_CHUNK_MS) {
            const chunkEnd = Math.min(cursor + HISTORY_CHUNK_MS, end);
            try {
                const rows = await this.queued(
                    () => this.client.signedGet("/fapi/v1/userTrades", {
                        symbol: sym,
                        startTime: cursor,
                        endTime: chunkEnd,
                        limit: 1000,
                    }),
                    5
                );
                if (Array.isArray(rows)) {
                    for (const row of rows) {
                        out.push({
                            id: row.id,
                            symbol: row.symbol,
                            positionSide: row.positionSide,
                            side: row.side,
                            realizedPnl: row.realizedPnl,
                            commission: row.commission,
                            qty: row.qty,
                            price: row.price,
                            time: row.time,
                        });
                    }
                }
            } catch (error) {
                if (error.status === 429) throw error;
                console.error("[BinanceFuturesAdapter.fetchUserTradesRange]", sym, error.message);
            }
            if (chunkEnd < end) await sleep(200);
        }
        return out;
    }

    /**
     * Lịch sử vị thế đóng gần với menu Binance Position History.
     * Nguồn: userTrades (tái tạo vòng đóng) + fallback income REALIZED_PNL.
     */
    async fetchPositionHistory({ startTime, endTime, limit = 100 } = {}) {
        this.requireCapability("history");
        const end = Number.isFinite(Number(endTime)) ? Number(endTime) : Date.now();
        const start = Number.isFinite(Number(startTime)) ? Number(startTime) : end - 3 * DAY_MS;
        if (!(end >= start)) return [];

        let incomes = [];
        try {
            incomes = await this.fetchIncomeRange({
                startTime: start,
                endTime: end,
                incomeType: "REALIZED_PNL",
            });
        } catch (error) {
            if (error.status === 429) throw error;
            console.error("[BinanceFuturesAdapter.fetchPositionHistory] income", error.message);
        }

        const score = new Map();
        for (const row of incomes) {
            const symbol = String(row.symbol || "").toUpperCase();
            if (!symbol) continue;
            score.set(symbol, (score.get(symbol) || 0) + Math.abs(Number(row.income) || 0));
        }
        const symbols = [...score.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([symbol]) => symbol)
            .slice(0, MAX_HISTORY_SYMBOLS);

        const reconstructed = [];
        const seen = new Set();
        for (let i = 0; i < symbols.length; i += 1) {
            if (i > 0) await sleep(250);
            try {
                const trades = await this.fetchUserTradesRange(symbols[i], start, end);
                for (const row of reconstructClosedFromTrades(trades)) {
                    if (row.time && (row.time < start || row.time > end)) continue;
                    const key = historyRowKey(row);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    reconstructed.push(row);
                }
            } catch (error) {
                if (error.status === 429) throw error;
                console.error("[BinanceFuturesAdapter.fetchPositionHistory] trades", symbols[i], error.message);
            }
        }

        if (!reconstructed.length) {
            return groupRealizedPnlIncomes(incomes);
        }

        const covered = new Set(reconstructed.map((row) => String(row.symbol || "").toUpperCase()));
        const fallback = groupRealizedPnlIncomes(
            incomes.filter((row) => !covered.has(String(row.symbol || "").toUpperCase()))
        );
        const merged = [...reconstructed, ...fallback]
            .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
        const maxRows = Math.max(100, Number(limit) || 100) * 20;
        return merged.slice(0, maxRows);
    }

    async getHistoryDetails({ positions = null } = {}) {
        this.requireCapability("history");
        const now = Date.now();
        const startTime = now - 3 * DAY_MS;
        let income = [];
        let positionHistory = [];
        const trades = [];

        try {
            const incomeRaw = await this.fetchIncomeRange({ startTime, endTime: now });
            income = incomeRaw.map((row) => ({
                symbol: row.symbol,
                incomeType: row.incomeType,
                income: row.income,
                time: row.time,
            }));
        } catch (error) {
            if (error.status === 429) throw error;
            console.error("[BinanceFuturesAdapter.getHistoryDetails] income", error.message);
        }

        const openPositions = Array.isArray(positions) ? positions : [];
        const symbols = [...new Set(openPositions.map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean))].slice(0, 15);
        for (let i = 0; i < symbols.length; i += 1) {
            const symbol = symbols[i];
            if (i > 0) await sleep(350);
            try {
                const rows = await this.fetchUserTradesRange(symbol, startTime, now);
                trades.push(...rows);
            } catch (error) {
                if (error.status === 429) throw error;
                console.error("[BinanceFuturesAdapter.getHistoryDetails] trades", symbol, error.message);
            }
        }

        positionHistory = reconstructClosedFromTrades(trades);
        if (!positionHistory.length) {
            positionHistory = groupRealizedPnlIncomes(
                income.filter((row) => String(row.incomeType || "").toUpperCase() === "REALIZED_PNL")
            );
        }

        return { income, positionHistory, trades, at: new Date(now).toISOString() };
    }

    async getBalance() {
        const rows = await this.queued(() => this.client.signedGet("/fapi/v2/balance", {}), 5);
        return Array.isArray(rows) ? rows : [];
    }

    async getMarkPrices(instruments = []) {
        const map = {};
        try {
            const rows = await this.client.publicGet("/fapi/v1/ticker/price");
            for (const row of Array.isArray(rows) ? rows : []) {
                map[String(row.symbol || "").toUpperCase()] = toNum(row.price);
            }
        } catch (error) {
            console.error("[BinanceFuturesAdapter.getMarkPrices]", error.message);
        }
        if (!instruments?.length) return map;
        const out = {};
        for (const id of instruments) {
            const key = String(id || "").toUpperCase();
            if (map[key] != null) out[key] = map[key];
        }
        return out;
    }

    async getInstrument(instrumentId) {
        return findSymbolInfo(instrumentId);
    }

    resolveWorkingType(value) {
        const raw = String(value || "CONTRACT_PRICE").toUpperCase();
        if (raw === "MARK" || raw === "MARK_PRICE") return "MARK_PRICE";
        return "CONTRACT_PRICE";
    }

    async closePosition(input = {}) {
        this.requireCapability("close");
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const positionSide = String(input.side || input.positionSide || "BOTH").toUpperCase();
        if (!symbol) throw httpError(400, "Thiếu symbol");

        const positions = await this.client.signedGet("/fapi/v2/positionRisk", { symbol });
        const position = (Array.isArray(positions) ? positions : []).find(
            (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
        );
        if (!position || Math.abs(parseFloat(position.positionAmt)) < 1e-8) {
            return { success: true, message: "Position đã đóng hoặc không tồn tại", exchange: "binance" };
        }

        const positionAmt = Math.abs(parseFloat(position.positionAmt));
        let closeQty = positionAmt;
        if (input.quantityMode === "PERCENT") closeQty = positionAmt * (parseFloat(input.percent) / 100);
        else if (input.quantityMode === "QUANTITY") closeQty = Math.min(parseFloat(input.quantity), positionAmt);

        const info = await findSymbolInfo(symbol);
        const qtyText = floorToStep(closeQty, info?.stepSize);
        if (!qtyText) throw httpError(400, "Số lượng đóng sau làm tròn = 0 (kiểm tra stepSize)");

        const isLong = parseFloat(position.positionAmt) > 0;
        const type = String(input.orderType || "MARKET").toUpperCase();
        const posSide = position.positionSide || "BOTH";
        const orderParams = {
            symbol,
            side: isLong ? "SELL" : "BUY",
            positionSide: posSide,
            type,
            quantity: qtyText,
        };
        if (posSide === "BOTH") orderParams.reduceOnly = "true";
        if (type === "LIMIT") {
            const priceText = roundToTick(input.price, info?.tickSize);
            if (!priceText) throw httpError(400, "LIMIT close cần giá hợp lệ");
            orderParams.price = priceText;
            orderParams.timeInForce = "GTC";
        }

        const result = await this.client.signed("POST", "/fapi/v1/order", orderParams);
        return { success: true, orderId: result?.orderId, result, exchange: "binance" };
    }

    async openPosition(input = {}) {
        this.requireCapability("open");
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const positionSide = String(input.side || input.positionSide || "LONG").toUpperCase();
        const type = String(input.orderType || "MARKET").toUpperCase();
        const info = await findSymbolInfo(symbol);
        const qtyText = floorToStep(input.quantity, info?.stepSize);
        if (!qtyText) throw httpError(400, "Quantity sau làm tròn = 0");

        const orderParams = {
            symbol,
            side: positionSide === "SHORT" ? "SELL" : "BUY",
            positionSide: positionSide || "BOTH",
            type,
            quantity: qtyText,
        };
        if (type === "LIMIT") {
            const priceText = roundToTick(input.price, info?.tickSize);
            if (!priceText) throw httpError(400, "LIMIT open cần giá hợp lệ");
            orderParams.price = priceText;
            orderParams.timeInForce = "GTC";
        }
        const result = await this.client.signed("POST", "/fapi/v1/order", orderParams);
        return { success: true, orderId: result?.orderId, result, exchange: "binance" };
    }

    async cancelOrder(input = {}) {
        const kind = String(input.orderKind || input.kind || "regular").toLowerCase();
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const id = String(input.orderId || input.algoId || "").trim();
        if (!id) throw httpError(400, "Thiếu orderId");
        if (!symbol) throw httpError(400, "Thiếu symbol");

        const cancelAlgo = () => this.client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: id });
        const cancelRegular = () => this.client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: id });

        // Ưu tiên đúng kind; nếu Unknown order thì thử endpoint còn lại (Redis kind đôi khi lệch).
        if (kind === "conditional" || kind === "algo") {
            this.requireCapability("conditionalOrder");
            try {
                const result = await cancelAlgo();
                return { success: true, orderId: id, algoId: id, result, exchange: "binance" };
            } catch (error) {
                console.warn("[BinanceFuturesAdapter.cancelOrder] algo failed, try regular:", error.message);
                try {
                    const result = await cancelRegular();
                    return { success: true, orderId: id, result, exchange: "binance" };
                } catch (fallbackError) {
                    throw httpError(400, `Huỷ algo #${id} thất bại: ${error.message || fallbackError.message}`);
                }
            }
        }
        if (kind === "regular" || kind === "order") {
            this.requireCapability("regularOrder");
            try {
                const result = await cancelRegular();
                return { success: true, orderId: id, result, exchange: "binance" };
            } catch (error) {
                console.warn("[BinanceFuturesAdapter.cancelOrder] regular failed, try algo:", error.message);
                try {
                    const result = await cancelAlgo();
                    return { success: true, orderId: id, algoId: id, result, exchange: "binance" };
                } catch (fallbackError) {
                    throw httpError(400, `Huỷ order #${id} thất bại: ${error.message || fallbackError.message}`);
                }
            }
        }

        this.requireCapability("regularOrder");
        try {
            const result = await cancelRegular();
            return { success: true, orderId: id, result, exchange: "binance" };
        } catch (error) {
            console.warn("[BinanceFuturesAdapter.cancelOrder] regular failed, try algo:", error.message);
            const result = await cancelAlgo();
            return { success: true, orderId: id, algoId: id, result, exchange: "binance" };
        }
    }

    async createOrder(input = {}) {
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const orderType = String(input.type || "LIMIT").toUpperCase();
        const info = await findSymbolInfo(symbol);
        const closeAll = input.closePosition === true || input.closePosition === "true" || input.closeOnTrigger === true;

        if (ALGO_ORDER_TYPES.has(orderType)) {
            this.requireCapability("conditionalOrder");
            const orderParams = {
                algoType: "CONDITIONAL",
                symbol,
                side: String(input.side || "").toUpperCase(),
                positionSide: String(input.positionSide || "BOTH").toUpperCase(),
                type: orderType,
                workingType: this.resolveWorkingType(input.workingType || input.triggerSource),
            };
            if (orderType === "TRAILING_STOP_MARKET") {
                const rate = Number(input.callbackRate);
                if (!(rate >= 0.1 && rate <= 10)) throw httpError(400, "callbackRate trailing phải 0.1–10");
                orderParams.callbackRate = String(rate);
                if (input.triggerPrice != null && input.triggerPrice !== "") {
                    const act = roundToTick(input.triggerPrice, info?.tickSize);
                    if (act) orderParams.activatePrice = act;
                }
            } else {
                const triggerText = roundToTick(input.triggerPrice || input.price, info?.tickSize);
                if (!triggerText) throw httpError(400, "Thiếu triggerPrice cho algo order");
                orderParams.triggerPrice = triggerText;
            }
            if (closeAll) orderParams.closePosition = "true";
            else {
                const qtyText = floorToStep(input.quantity, info?.stepSize);
                if (!qtyText) throw httpError(400, "Quantity sau làm tròn = 0");
                orderParams.quantity = qtyText;
            }
            if (orderType === "STOP" || orderType === "TAKE_PROFIT") {
                const priceText = roundToTick(input.price, info?.tickSize);
                if (!priceText) throw httpError(400, "STOP/TAKE_PROFIT cần giá limit");
                orderParams.price = priceText;
                orderParams.timeInForce = String(input.timeInForce || "GTC").toUpperCase();
            }
            const result = await this.client.signed("POST", "/fapi/v1/algoOrder", orderParams);
            return { success: true, orderId: result?.algoId || result?.orderId, algoId: result?.algoId, result, exchange: "binance" };
        }

        this.requireCapability("regularOrder");
        const qtyText = floorToStep(input.quantity, info?.stepSize);
        if (!qtyText) throw httpError(400, "Quantity sau làm tròn = 0");
        const orderParams = {
            symbol,
            side: String(input.side || "").toUpperCase(),
            positionSide: String(input.positionSide || "BOTH").toUpperCase(),
            type: orderType,
            quantity: qtyText,
        };
        if (input.reduceOnly === true || input.reduceOnly === "true") orderParams.reduceOnly = "true";
        if (orderType === "LIMIT") {
            const priceText = roundToTick(input.price, info?.tickSize);
            if (!priceText) throw httpError(400, "LIMIT cần giá hợp lệ");
            orderParams.price = priceText;
            orderParams.timeInForce = String(input.timeInForce || "GTC").toUpperCase();
        }
        const result = await this.client.signed("POST", "/fapi/v1/order", orderParams);
        return { success: true, orderId: result?.orderId, result, exchange: "binance" };
    }

    async replaceOrder(input = {}) {
        const cancelled = await this.cancelOrder(input);
        const created = await this.createOrder(input);
        return { success: true, cancelled, created, orderId: created?.orderId || created?.algoId, exchange: "binance" };
    }

    async reversePosition(input = {}) {
        this.requireCapability("reverse");
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const positionSide = String(input.side || input.positionSide || "").toUpperCase();
        const positions = await this.client.signedGet("/fapi/v2/positionRisk", { symbol });
        const position = (Array.isArray(positions) ? positions : []).find(
            (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
        );
        const currentQty = Math.abs(parseFloat(position?.positionAmt || 0));
        if (!(currentQty > 0)) throw httpError(400, "Position không tồn tại để reverse");
        const openQty = input.newQuantity != null && input.newQuantity !== "" ? input.newQuantity : currentQty;

        const closeResult = await this.closePosition({
            ...input,
            symbol,
            positionSide,
            orderType: input.closeOrderType || "MARKET",
            quantityMode: "ALL",
        });
        if (!closeResult?.success) return { success: false, error: "Close failed", closeResult, exchange: "binance" };

        const newSide = positionSide === "LONG" ? "SHORT" : "LONG";
        const openResult = await this.openPosition({
            ...input,
            symbol,
            positionSide: newSide,
            side: newSide,
            orderType: input.openOrderType || "MARKET",
            quantity: openQty,
        });
        return { success: true, closeResult, openResult, openQty, newSide, exchange: "binance" };
    }

    tpslTriggerOf(params, kind) {
        if (kind === "tp") {
            if (params?.tp != null && params.tp !== "") return params.tp;
            return params?.takeProfit?.triggerPrice ?? params?.takeProfit?.price ?? null;
        }
        if (params?.sl != null && params.sl !== "") return params.sl;
        return params?.stopLoss?.triggerPrice ?? params?.stopLoss?.price ?? null;
    }

    async cancelProtectiveOrders(symbol, positionSide, kinds) {
        const cancelled = [];
        const [algoRaw, openRaw] = await Promise.all([
            this.client.signedGet("/fapi/v1/openAlgoOrders", { symbol }).catch((error) => {
                console.warn("[BinanceFuturesAdapter.cancelProtectiveOrders] openAlgoOrders", error.message);
                return [];
            }),
            this.client.signedGet("/fapi/v1/openOrders", { symbol }).catch((error) => {
                console.warn("[BinanceFuturesAdapter.cancelProtectiveOrders] openOrders", error.message);
                return [];
            }),
        ]);
        const algoList = Array.isArray(algoRaw) ? algoRaw : (algoRaw?.orders || []);
        for (const order of algoList) {
            const type = String(order?.type || order?.orderType || "").toUpperCase();
            const side = String(order.positionSide || "BOTH").toUpperCase();
            const want = String(positionSide || "BOTH").toUpperCase();
            if (want && want !== "BOTH" && side !== "BOTH" && side !== want) continue;
            const match = (kinds || []).some((kind) => {
                if (kind === "TAKE_PROFIT") return type.includes("TAKE_PROFIT");
                if (kind === "STOP") return type === "STOP" || type === "STOP_MARKET";
                if (kind === "TRAILING") return type.includes("TRAILING");
                return type.includes(kind);
            });
            if (!match) continue;
            const algoId = order.algoId || order.orderId;
            if (!algoId) continue;
            try {
                await this.client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: String(algoId) });
                cancelled.push({ algoId, type, via: "algo" });
            } catch (error) {
                console.warn("[BinanceFuturesAdapter.cancelProtectiveOrders] algo", algoId, error.message);
            }
        }
        for (const order of Array.isArray(openRaw) ? openRaw : []) {
            const type = String(order?.type || order?.orderType || "").toUpperCase();
            if (!ALGO_ORDER_TYPES.has(type) && !order.closePosition) continue;
            const side = String(order.positionSide || "BOTH").toUpperCase();
            const want = String(positionSide || "BOTH").toUpperCase();
            if (want && want !== "BOTH" && side !== "BOTH" && side !== want) continue;
            const match = (kinds || []).some((kind) => {
                if (kind === "TAKE_PROFIT") return type.includes("TAKE_PROFIT");
                if (kind === "STOP") return type === "STOP" || type === "STOP_MARKET";
                if (kind === "TRAILING") return type.includes("TRAILING");
                return type.includes(kind);
            });
            if (!match) continue;
            try {
                await this.client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: order.orderId });
                cancelled.push({ orderId: order.orderId, type, via: "order" });
            } catch (error) {
                console.warn("[BinanceFuturesAdapter.cancelProtectiveOrders] order", order.orderId, error.message);
            }
        }
        return cancelled;
    }

    async placeAlgoProtective({
        symbol, side, positionSide, type, triggerPrice, workingType, limitPrice, callbackRate, activationPrice,
    }) {
        const params = {
            algoType: "CONDITIONAL",
            symbol,
            side,
            positionSide,
            type,
            closePosition: "true",
            workingType: this.resolveWorkingType(workingType),
        };
        if (type === "TRAILING_STOP_MARKET") {
            params.callbackRate = String(callbackRate);
            if (activationPrice) params.activationPrice = String(activationPrice);
        } else {
            params.triggerPrice = String(triggerPrice);
            if ((type === "STOP" || type === "TAKE_PROFIT") && limitPrice) {
                params.price = String(limitPrice);
                params.timeInForce = "GTC";
            }
        }
        const result = await this.client.signed("POST", "/fapi/v1/algoOrder", params);
        return {
            algoId: result?.algoId || result?.orderId,
            orderId: result?.algoId || result?.orderId,
            result,
        };
    }

    async setTpsl(input = {}) {
        const trail = input?.trailing || {};
        if (trail.enabled !== false && trail.callbackRate != null && trail.callbackRate !== "") {
            this.requireCapability("trailing");
        } else {
            this.requireCapability("tpsl");
        }
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const positionSide = String(input.side || input.positionSide || "BOTH").toUpperCase();
        const tpRaw = this.tpslTriggerOf(input, "tp");
        const slRaw = this.tpslTriggerOf(input, "sl");
        const tpEnabled = input?.takeProfit?.enabled !== false && tpRaw != null && tpRaw !== "";
        const slEnabled = input?.stopLoss?.enabled !== false && slRaw != null && slRaw !== "";
        const trailCancelOnly = trail.enabled === false && trail.cancel === true;
        const trailEnabled = trail.enabled !== false && trail.callbackRate != null && trail.callbackRate !== "";
        if (!tpEnabled && !slEnabled && !trailEnabled && !trailCancelOnly) {
            throw httpError(400, "Cần ít nhất TP, SL hoặc Trailing");
        }

        const positions = await this.client.signedGet("/fapi/v2/positionRisk", { symbol });
        const position = (Array.isArray(positions) ? positions : []).find(
            (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
        );
        if (!position || Math.abs(parseFloat(position.positionAmt)) < 1e-8) {
            throw httpError(400, "Position không tồn tại");
        }

        const isLong = parseFloat(position.positionAmt) > 0;
        const closeSide = isLong ? "SELL" : "BUY";
        const posSide = position.positionSide || "BOTH";
        const info = await findSymbolInfo(symbol);
        const results = [];
        const cancelKinds = [];
        if (tpEnabled) cancelKinds.push("TAKE_PROFIT");
        if (slEnabled) cancelKinds.push("STOP");
        if (trailEnabled || trailCancelOnly) cancelKinds.push("TRAILING");
        const cancelled = await this.cancelProtectiveOrders(symbol, posSide, cancelKinds);

        if (trailCancelOnly && !tpEnabled && !slEnabled && !trailEnabled) {
            return {
                success: true,
                results: [{ type: "TRAILING", success: true, cancelled: true }],
                cancelled,
                exchange: "binance",
                protectionMode: "conditional-order",
            };
        }

        if (tpEnabled) {
            try {
                const triggerPrice = roundToTick(tpRaw, info?.tickSize);
                if (!triggerPrice) throw httpError(400, "Giá TP không hợp lệ");
                const workingType = this.resolveWorkingType(input?.tpWorkingType || input?.takeProfit?.workingType || input?.workingType);
                const tpType = String(input?.tpType || input?.takeProfit?.type || "TAKE_PROFIT_MARKET").toUpperCase();
                const placed = await this.placeAlgoProtective({
                    symbol, side: closeSide, positionSide: posSide, type: tpType, triggerPrice, workingType,
                    limitPrice: input?.takeProfit?.limitPrice,
                });
                results.push({ type: "TP", success: true, orderId: placed.orderId, algoId: placed.algoId, stopPrice: triggerPrice, workingType });
            } catch (error) {
                results.push({ type: "TP", success: false, error: error.message });
            }
        }
        if (slEnabled) {
            try {
                const triggerPrice = roundToTick(slRaw, info?.tickSize);
                if (!triggerPrice) throw httpError(400, "Giá SL không hợp lệ");
                const workingType = this.resolveWorkingType(input?.slWorkingType || input?.stopLoss?.workingType || input?.workingType);
                const slType = String(input?.slType || input?.stopLoss?.type || "STOP_MARKET").toUpperCase();
                const placed = await this.placeAlgoProtective({
                    symbol, side: closeSide, positionSide: posSide, type: slType, triggerPrice, workingType,
                    limitPrice: input?.stopLoss?.limitPrice,
                });
                results.push({ type: "SL", success: true, orderId: placed.orderId, algoId: placed.algoId, stopPrice: triggerPrice, workingType });
            } catch (error) {
                results.push({ type: "SL", success: false, error: error.message });
            }
        }
        if (trailEnabled) {
            try {
                const callbackRate = Number(trail.callbackRate);
                if (!(callbackRate >= 0.1 && callbackRate <= 10)) {
                    throw httpError(400, "callbackRate trailing phải trong 0.1–10 (%)");
                }
                const activation = trail.activationPrice ? roundToTick(trail.activationPrice, info?.tickSize) : null;
                const workingType = this.resolveWorkingType(trail.workingType || input?.workingType);
                const placed = await this.placeAlgoProtective({
                    symbol, side: closeSide, positionSide: posSide, type: "TRAILING_STOP_MARKET",
                    callbackRate, activationPrice: activation || undefined, workingType,
                });
                results.push({
                    type: "TRAILING", success: true, orderId: placed.orderId, algoId: placed.algoId,
                    callbackRate, activationPrice: activation, workingType,
                });
            } catch (error) {
                results.push({ type: "TRAILING", success: false, error: error.message });
            }
        }

        const failed = results.filter((row) => !row.success);
        if (failed.length && failed.length === results.length) {
            throw httpError(400, failed.map((row) => `${row.type}: ${row.error}`).join("; "));
        }
        return {
            success: failed.length === 0,
            results,
            cancelled,
            exchange: "binance",
            protectionMode: "conditional-order",
        };
    }

    async cancelTpsl(input = {}) {
        this.requireCapability("tpsl");
        const symbol = String(input.instrumentId || input.symbol || "").toUpperCase();
        const id = String(input.orderId || input.algoId || "").trim();
        if (!id) throw httpError(400, "Thiếu orderId/algoId");
        const kind = String(input.kind || input.orderKind || "algo").toLowerCase();
        if (kind === "algo" || kind === "conditional" || kind === "tp" || kind === "sl") {
            try {
                const result = await this.client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: id });
                return { success: true, orderId: id, algoId: id, result, exchange: "binance", protectionMode: "conditional-order" };
            } catch (error) {
                console.warn("[BinanceFuturesAdapter.cancelTpsl] algo failed, try regular:", error.message);
            }
        }
        try {
            const result = await this.client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: id });
            return { success: true, orderId: id, result, exchange: "binance", protectionMode: "conditional-order" };
        } catch (error) {
            const result = await this.client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: id });
            return { success: true, orderId: id, algoId: id, result, exchange: "binance", protectionMode: "conditional-order" };
        }
    }
}

module.exports = {
    BinanceFuturesAdapter,
    ALGO_ORDER_TYPES,
    groupRealizedPnlIncomes,
    reconstructClosedFromTrades,
    tradeQtyDelta,
};
