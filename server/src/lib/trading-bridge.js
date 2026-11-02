/**
 * Trading bridge cho typed MQTT trading/request/v1.
 * Spec: trading-terminal-spec.md
 * 
 * Phase B: ORDER_CANCEL
 * Phase C: POSITION_SET_TPSL, POSITION_CANCEL_TPSL
 * Phase D: POSITION_CLOSE
 * Phase E: POSITION_OPEN
 * Phase F: ORDER_REPLACE, POSITION_REVERSE
 */
const crypto = require("crypto");
const { PERMISSIONS, hasPermission, canAccessResource } = require("../auth/access-control");
const { httpError } = require("./http");
const TradingReceipt = require("../models/trading-receipt");
const {
    receiptStatusFromResult,
    assertReceiptStatus,
    isTerminalReceiptStatus,
} = require("./trading-receipt-status");
const UserAccount = require("../models/user-account");
const { executeDirectTrading } = require("./direct-trading");
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Trading action catalog.
 * Mỗi action có permission và validation riêng.
 */
const TRADING_ACTIONS = Object.freeze({
    ORDER_CANCEL: {
        permission: "orders.cancel",
        requiredFields: ["kind", "orderId", "symbol"],
        validate: validateOrderCancel,
    },
    ORDER_CANCEL_BATCH: {
        permission: "orders.cancel",
        requiredFields: ["orders"],
        validate: validateOrderCancelBatch,
    },
    POSITION_SET_TPSL: {
        permission: "positions.tpsl",
        requiredFields: [],
        validate: validateSetTpsl,
    },
    POSITION_CANCEL_TPSL: {
        permission: "positions.tpsl",
        requiredFields: ["kind", "orderId"],
        validate: validateCancelTpsl,
    },
    POSITION_CLOSE: {
        permission: "positions.close",
        requiredFields: ["orderType", "quantityMode"],
        validate: validatePositionClose,
    },
    POSITION_OPEN: {
        permission: "positions.open",
        requiredFields: ["orderType", "quantity"],
        validate: validatePositionOpen,
    },
    POSITION_REVERSE: {
        permissions: ["positions.open", "positions.close"],
        requiredFields: ["closeOrderType", "openOrderType"],
        validate: validatePositionReverse,
    },
    ORDER_CREATE: {
        permission: "orders.create",
        requiredFields: ["side", "positionSide", "type"],
        validate: validateOrderCreate,
    },
    ORDER_REPLACE: {
        permission: "orders.edit",
        requiredFields: ["kind", "orderId", "symbol"],
        validate: validateOrderReplace,
    },
});

// Permissions mới cần thêm vào access-control
const TRADING_PERMISSIONS = {
    ORDERS_CANCEL: "orders.cancel",
    ORDERS_CREATE: "orders.create",
    ORDERS_EDIT: "orders.edit",
    POSITIONS_TPSL: "positions.tpsl",
};

/**
 * Validation functions
 */
function validateOrderCancel(params) {
    const kind = String(params.kind || "").toLowerCase();
    if (kind !== "regular" && kind !== "algo") {
        return { valid: false, error: "kind phải là regular hoặc algo" };
    }
    const orderId = String(params.orderId || "").trim();
    if (!orderId) {
        return { valid: false, error: "Thiếu orderId" };
    }
    const symbol = String(params.symbol || "").trim().toUpperCase();
    if (!symbol) {
        return { valid: false, error: "Thiếu symbol" };
    }
    return { valid: true, normalized: { kind, orderId, symbol } };
}

function validateOrderCancelBatch(params) {
    if (!Array.isArray(params.orders) || !params.orders.length) {
        return { valid: false, error: "Cần mảng orders không rỗng" };
    }
    if (params.orders.length > 20) {
        return { valid: false, error: "Tối đa 20 orders mỗi batch" };
    }
    const normalized = [];
    for (const order of params.orders) {
        const result = validateOrderCancel(order);
        if (!result.valid) return result;
        normalized.push(result.normalized);
    }
    return { valid: true, normalized: { orders: normalized } };
}

function validateSetTpsl(params) {
    const body = params || {};
    const tp = body.tp ?? body.takeProfit?.triggerPrice ?? body.takeProfit?.price;
    const sl = body.sl ?? body.stopLoss?.triggerPrice ?? body.stopLoss?.price;
    const trail = body.trailing || {};
    const tpOn = body.takeProfit?.enabled !== false && tp != null && tp !== "";
    const slOn = body.stopLoss?.enabled !== false && sl != null && sl !== "";
    const trailCancelOnly = trail.enabled === false && trail.cancel === true;
    const trailOn = trail.enabled !== false && trail.callbackRate != null && trail.callbackRate !== "";
    if (!tpOn && !slOn && !trailOn && !trailCancelOnly) {
        return { valid: false, error: "Cần ít nhất TP, SL hoặc Trailing" };
    }
    if (tpOn && !(Number(tp) > 0)) return { valid: false, error: "Giá TP phải > 0" };
    if (slOn && !(Number(sl) > 0)) return { valid: false, error: "Giá SL phải > 0" };
    if (trailOn) {
        const rate = Number(trail.callbackRate);
        if (!(rate >= 0.1 && rate <= 10)) return { valid: false, error: "callbackRate trailing phải trong 0.1–10 (%)" };
    }
    const workingType = String(body.workingType || body.tpWorkingType || body.slWorkingType || trail.workingType || "CONTRACT_PRICE").toUpperCase();
    if (!["CONTRACT_PRICE", "MARK_PRICE", "LAST", "MARK"].includes(workingType)) {
        return { valid: false, error: "workingType phải là CONTRACT_PRICE (Last) hoặc MARK_PRICE" };
    }
    return {
        valid: true,
        normalized: {
            ...body,
            tp: tpOn ? String(tp) : undefined,
            sl: slOn ? String(sl) : undefined,
            workingType: workingType === "MARK" || workingType === "MARK_PRICE" ? "MARK_PRICE" : "CONTRACT_PRICE",
        },
    };
}

function validateCancelTpsl(params) {
    // Phase C implementation
    const kind = String(params.kind || "").toLowerCase();
    if (kind !== "tp" && kind !== "sl" && kind !== "order" && kind !== "algo") {
        return { valid: false, error: "kind phải là tp, sl, order hoặc algo" };
    }
    return { valid: true, normalized: params };
}

function validatePositionClose(params) {
    // Phase D implementation
    const orderType = String(params.orderType || "").toUpperCase();
    if (orderType !== "MARKET" && orderType !== "LIMIT") {
        return { valid: false, error: "orderType phải là MARKET hoặc LIMIT" };
    }
    const quantityMode = String(params.quantityMode || "").toUpperCase();
    if (!["ALL", "PERCENT", "QUANTITY"].includes(quantityMode)) {
        return { valid: false, error: "quantityMode phải là ALL, PERCENT hoặc QUANTITY" };
    }
    if (quantityMode === "QUANTITY") {
        const quantity = Number(params.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return { valid: false, error: "quantity phải > 0" };
        }
    }
    if (quantityMode === "PERCENT") {
        const percent = Number(params.percent);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
            return { valid: false, error: "percent phải trong khoảng 1–100" };
        }
    }
    if (orderType === "LIMIT") {
        const price = Number(params.price);
        if (!Number.isFinite(price) || price <= 0) {
            return { valid: false, error: "LIMIT close cần price > 0" };
        }
    }
    return {
        valid: true,
        normalized: {
            ...params,
            orderType,
            quantityMode,
        },
    };
}

function validatePositionOpen(params) {
    // Phase E implementation
    const orderType = String(params.orderType || "").toUpperCase();
    if (orderType !== "MARKET" && orderType !== "LIMIT") {
        return { valid: false, error: "orderType phải là MARKET hoặc LIMIT" };
    }
    const quantity = Number(params.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { valid: false, error: "quantity phải > 0" };
    }
    return { valid: true, normalized: params };
}

function validatePositionReverse(params) {
    const closeOrderType = String(params.closeOrderType || "MARKET").toUpperCase();
    const openOrderType = String(params.openOrderType || "MARKET").toUpperCase();
    if (closeOrderType !== "MARKET" && closeOrderType !== "LIMIT") {
        return { valid: false, error: "closeOrderType phải là MARKET hoặc LIMIT" };
    }
    if (openOrderType !== "MARKET" && openOrderType !== "LIMIT") {
        return { valid: false, error: "openOrderType phải là MARKET hoặc LIMIT" };
    }
    if (params.newQuantity != null && params.newQuantity !== "" && !(Number(params.newQuantity) > 0)) {
        return { valid: false, error: "newQuantity phải > 0" };
    }
    return {
        valid: true,
        normalized: {
            ...params,
            closeOrderType,
            openOrderType,
        },
    };
}

const ALGO_CREATE_TYPES = new Set([
    "STOP",
    "STOP_MARKET",
    "TAKE_PROFIT",
    "TAKE_PROFIT_MARKET",
    "TRAILING_STOP_MARKET",
]);

function validateOrderCreate(params) {
    const side = String(params.side || "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") {
        return { valid: false, error: "side phải là BUY hoặc SELL" };
    }
    const positionSide = String(params.positionSide || "BOTH").toUpperCase();
    if (!["LONG", "SHORT", "BOTH"].includes(positionSide)) {
        return { valid: false, error: "positionSide phải LONG, SHORT hoặc BOTH" };
    }
    const type = String(params.type || "").toUpperCase();
    const allowed = ["MARKET", "LIMIT", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET"];
    if (!allowed.includes(type)) {
        return { valid: false, error: `type không hỗ trợ: ${type || "(trống)"}` };
    }
    const closeAll = params.closePosition === true || params.closePosition === "true";
    const qty = Number(params.quantity);
    if (!closeAll && !(qty > 0)) {
        return { valid: false, error: "quantity phải > 0 (hoặc bật closePosition)" };
    }
    if (type === "LIMIT" && !(Number(params.price) > 0)) {
        return { valid: false, error: "LIMIT cần price > 0" };
    }
    if ((type === "STOP" || type === "TAKE_PROFIT") && !(Number(params.price) > 0)) {
        return { valid: false, error: "STOP/TAKE_PROFIT cần price (limit) > 0" };
    }
    if (["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(type)) {
        const trigger = params.triggerPrice ?? (type.endsWith("_MARKET") ? params.price : null);
        if (!(Number(trigger) > 0) && !(type.endsWith("_MARKET") && Number(params.price) > 0)) {
            return { valid: false, error: "Cần triggerPrice > 0" };
        }
    }
    if (type === "TRAILING_STOP_MARKET") {
        const rate = Number(params.callbackRate);
        if (!(rate >= 0.1 && rate <= 10)) {
            return { valid: false, error: "callbackRate trailing phải 0.1–10" };
        }
    }
    const kind = ALGO_CREATE_TYPES.has(type) ? "algo" : String(params.kind || "regular").toLowerCase();
    return {
        valid: true,
        normalized: {
            kind: kind === "algo" ? "algo" : "regular",
            side,
            positionSide,
            type,
            quantity: closeAll ? undefined : String(params.quantity),
            price: params.price != null && params.price !== "" ? String(params.price) : undefined,
            triggerPrice: params.triggerPrice != null && params.triggerPrice !== ""
                ? String(params.triggerPrice)
                : (type.endsWith("_MARKET") && params.price != null ? String(params.price) : undefined),
            callbackRate: params.callbackRate != null && params.callbackRate !== "" ? String(params.callbackRate) : undefined,
            reduceOnly: params.reduceOnly === true || params.reduceOnly === "true",
            closePosition: closeAll,
            workingType: params.workingType,
            timeInForce: params.timeInForce || "GTC",
        },
    };
}

function validateOrderReplace(params) {
    const kind = String(params.kind || "regular").toLowerCase();
    if (kind !== "regular" && kind !== "algo") {
        return { valid: false, error: "kind phải là regular hoặc algo" };
    }
    const orderId = String(params.orderId || "").trim();
    if (!orderId) return { valid: false, error: "Thiếu orderId" };
    const created = validateOrderCreate(params);
    if (!created.valid) return created;
    return {
        valid: true,
        normalized: {
            ...created.normalized,
            kind,
            orderId,
            symbol: String(params.symbol || "").toUpperCase() || undefined,
        },
    };
}

/**
 * Kiểm tra permission cho trading action.
 */
function hasActionPermission(actor, action) {
    const spec = TRADING_ACTIONS[action];
    if (!spec) return false;

    if (spec.permissions) {
        return spec.permissions.every((perm) => hasPermission(actor, perm));
    }
    return hasPermission(actor, spec.permission);
}

/**
 * Kiểm tra scope cho target bot.
 */
async function checkTargetAccess(actor, username, action) {
    const spec = TRADING_ACTIONS[action];
    if (!spec) throw httpError(400, `Action không hợp lệ: ${action}`);

    const permission = spec.permissions ? spec.permissions[0] : spec.permission;

    const bot = await UserAccount.findOne({ username }).select("username ownerUserId visibility active accounts").lean();
    if (!bot) throw httpError(404, "Không tìm thấy tài khoản");
    if (bot.active === false) throw httpError(400, "Tài khoản không active");
    if (!canAccessResource(actor, permission, bot)) {
        throw httpError(403, "Không có quyền với tài khoản này");
    }
    return bot;
}

/**
 * Kiểm tra idempotency key đã được xử lý chưa.
 */
async function checkIdempotency(actorUserId, idempotencyKey) {
    const existing = await TradingReceipt.findOne({
        actorUserId,
        idempotencyKey,
        expiresAt: { $gt: new Date() },
    }).lean();

    if (existing) {
        return {
            duplicate: true,
            receipt: existing,
        };
    }
    return { duplicate: false };
}

/**
 * Tạo và thực hiện trading request.
 * Gọi Binance API trực tiếp - không qua MQTT.
 */
async function createTradingRequest({
    actor,
    action,
    target,
    params,
    expected,
    idempotencyKey,
    previewId,
}) {
    // Validate action
    const spec = TRADING_ACTIONS[action];
    if (!spec) throw httpError(400, `Action không hợp lệ: ${action}`);

    // Check permission
    if (!hasActionPermission(actor, action)) {
        throw httpError(403, "Không có quyền thực hiện action này");
    }

    // Validate target
    if (!target?.username) throw httpError(400, "Thiếu target.username");
    await checkTargetAccess(actor, target.username, action);

    // Validate params
    for (const field of spec.requiredFields) {
        if (params[field] == null) {
            throw httpError(400, `Thiếu field: ${field}`);
        }
    }
    const validation = spec.validate(params);
    if (!validation.valid) {
        throw httpError(400, validation.error);
    }
    const normalized = {
        ...validation.normalized,
        // SL/TP trên preview/plan — không gửi trong cùng lệnh entry (bracket non-atomic).
        stopLoss: params.stopLoss != null && params.stopLoss !== "" ? String(params.stopLoss) : undefined,
        takeProfit: params.takeProfit != null && params.takeProfit !== "" ? String(params.takeProfit) : undefined,
    };

    // Generate IDs
    const requestId = crypto.randomUUID();
    const finalIdempotencyKey = idempotencyKey || requestId;
    const actorUserId = actor?.id || (actor?._id ? String(actor._id) : "");

    // Check idempotency
    const idempCheck = await checkIdempotency(actorUserId, finalIdempotencyKey);
    if (idempCheck.duplicate) {
        return {
            duplicate: true,
            command: publicTradingCommand(idempCheck.receipt),
        };
    }

    // Revalidate versioned preview tại submit (Q1) — lazy require tránh cycle.
    let previewMeta = null;
    if (previewId && (action === "ORDER_CREATE" || action === "POSITION_OPEN")) {
        const { assertPreviewForSubmit } = require("./trading-preview");
        previewMeta = await assertPreviewForSubmit(actor, {
            previewId,
            action,
            target,
            params: normalized,
        });
    }

    // Risk gate — tăng exposure. Close/tpsl không vào.
    // POSITION_REVERSE: không hard-gate cả saga; open-leg gate qua beforeOpen sau close.
    let riskMeta = null;
    const { gateTradingIncrease, bindAfterSubmit } = require("./risk-gate");
    if (["POSITION_OPEN", "ORDER_CREATE", "ORDER_REPLACE"].includes(action)) {
        riskMeta = await gateTradingIncrease({
            actor,
            action,
            target,
            params: normalized,
            loadBook: true,
        });
        if (riskMeta.required && !riskMeta.allowed) {
            throw httpError(409, riskMeta.reason || "Risk gate từ chối", {
                code: riskMeta.code || "risk_rejected",
            });
        }
        riskMeta.bindAfterSubmit = bindAfterSubmit;
    }

    const execParams = action === "POSITION_REVERSE"
        ? {
            ...normalized,
            beforeOpen: async ({ openQty, newSide, symbol }) => {
                const gate = await gateTradingIncrease({
                    actor,
                    action: "POSITION_REVERSE",
                    target: { ...target, symbol, positionSide: newSide },
                    params: {
                        ...normalized,
                        quantity: openQty,
                        phase: "open_leg",
                        positionSide: newSide,
                    },
                    loadBook: true,
                });
                if (gate.required && gate.allowed && gate.reservation?.reservationId) {
                    riskMeta = { ...gate, bindAfterSubmit };
                }
                return gate;
            },
        }
        : normalized;

    // Thực hiện trading qua Binance API trực tiếp (không qua MQTT config bridge)
    console.log(`[tradingBridge] ${action} for ${target.username}`);
    const now = Date.now();
    
    const result = await executeDirectTrading(action, target, execParams);

    if (riskMeta?.reservation?.reservationId && riskMeta.bindAfterSubmit) {
        await riskMeta.bindAfterSubmit(riskMeta.reservation.reservationId, {
            requestId,
            status: result?.success ? "submitted" : "unknown",
            exchangeOrderId: result?.orderId || result?.algoId || null,
        });
    }

    // Bracket không atomic: entry xong mà SL/TP trong preview chưa gắn → protection pending.
    let protection = null;
    const wantsProtect = normalized.stopLoss != null
        || normalized.takeProfit != null
        || previewMeta?.preview?.params?.stopLoss != null
        || previewMeta?.preview?.params?.takeProfit != null;
    if (result?.success && wantsProtect && (action === "ORDER_CREATE" || action === "POSITION_OPEN")) {
        protection = {
            status: "entry_filled_protection_pending",
            reason: "bracket_not_atomic",
            stopLoss: normalized.stopLoss || previewMeta?.preview?.params?.stopLoss || null,
            takeProfit: normalized.takeProfit || previewMeta?.preview?.params?.takeProfit || null,
        };
    } else if (result?.success === false && wantsProtect) {
        protection = {
            status: "entry_filled_protection_failed",
            reason: "entry_failed_before_protect",
        };
    }
    
    const receiptStatus = assertReceiptStatus(receiptStatusFromResult(result));
    const resultPayload = protection
        ? { ...result, protection, previewId: previewId || null }
        : result;

    // Receipt durable — lỗi persist không được nuốt mất kết quả sàn đã chạy
    let receiptPersisted = true;
    try {
        await TradingReceipt.create({
            requestId,
            idempotencyKey: finalIdempotencyKey,
            action,
            target: {
                username: target.username,
                env: target.env,
                symbol: target.symbol,
                positionSide: target.positionSide,
            },
            status: receiptStatus,
            result: resultPayload,
            actorUserId,
            actorUsername: actor?.username || actor?.email || "",
            expiresAt: new Date(now + IDEMPOTENCY_WINDOW_MS),
            completedAt: isTerminalReceiptStatus(receiptStatus) ? new Date(now) : undefined,
        });
    } catch (err) {
        receiptPersisted = false;
        console.error("[tradingBridge] receipt persist failed:", err.message);
    }

    // P3 timeline event (additive) — không đoán tradeInstanceId nếu thiếu
    try {
        const { appendTradeEvent } = require("./trade-events");
        await appendTradeEvent({
            source: "web-trading-bridge",
            sourceEventId: requestId,
            type: result?.success
                ? "submitted"
                : (result?.partial || result?.closeOk ? "partial_reverse" : "exchange_rejected"),
            reasonCode: result?.success ? undefined : (result?.openBlocked ? "risk_rejected" : "exchange_rejected"),
            account: target.username,
            env: target.env,
            symbol: target.symbol,
            side: target.positionSide,
            requestId,
            actorId: actorUserId,
            producer: "web-trading-bridge",
            tradeInstanceId: params?.tradeInstanceId || normalized?.tradeInstanceId || undefined,
            planId: params?.planId,
            signalEventId: params?.signalEventId,
            evidence: {
                action,
                protection: protection?.status || null,
                closeOk: result?.closeOk,
                openBlocked: result?.openBlocked,
                receiptStatus,
                receiptPersisted,
            },
        }, { trustedProducer: true });
    } catch (err) {
        console.warn("[tradingBridge] timeline", err.message);
    }

    return {
        duplicate: false,
        command: {
            requestId,
            action,
            status: receiptStatus,
            terminal: isTerminalReceiptStatus(receiptStatus),
            result: resultPayload,
            protection,
            previewId: previewId || null,
            reservationId: riskMeta?.reservation?.reservationId || null,
            receiptPersisted,
        },
    };
}

/**
 * Public command shape cho response.
 */
function publicTradingCommand(doc) {
    if (!doc) return null;
    const status = doc.status || "unknown";
    return {
        requestId: doc.requestId,
        idempotencyKey: doc.idempotencyKey,
        username: doc.username || doc.target?.username,
        action: doc.action,
        status,
        terminal: doc.terminal != null ? !!doc.terminal : isTerminalReceiptStatus(status),
        error: doc.error || null,
        result: doc.result || null,
        protection: doc.result?.protection || null,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

/**
 * Get trading command status.
 */
async function getTradingCommand(actor, requestId) {
    const doc = await TradingReceipt.findOne({
        requestId: String(requestId || ""),
    }).lean();

    if (!doc) throw httpError(404, "Không tìm thấy lệnh");

    const actorId = actor?.id || (actor?._id ? String(actor._id) : "");
    const isActor = doc.actorUserId && actorId && actorId === doc.actorUserId;

    if (!isActor) {
        // Check permission to view
        const canView = hasPermission(actor, PERMISSIONS.ORDERS_VIEW) ||
            hasPermission(actor, PERMISSIONS.POSITIONS_VIEW);
        if (!canView) throw httpError(403, "Không có quyền xem lệnh này");

        // Check scope
        await checkTargetAccess(actor, doc.target?.username, doc.action).catch(() => {
            throw httpError(403, "Không có quyền với tài khoản này");
        });
    }

    return publicTradingCommand(doc);
}

/**
 * Cancel order action.
 */
async function cancelOrder(actor, { username, kind, symbol, orderId, env, expected, idempotencyKey }) {
    return createTradingRequest({
        actor,
        action: "ORDER_CANCEL",
        target: {
            username,
            env,
            symbol: String(symbol || "").toUpperCase(),
        },
        params: {
            kind,
            orderId,
            symbol,
        },
        expected,
        idempotencyKey,
    });
}

/**
 * Cancel batch orders.
 */
async function cancelOrderBatch(actor, { username, orders, env, idempotencyKey }) {
    return createTradingRequest({
        actor,
        action: "ORDER_CANCEL_BATCH",
        target: {
            username,
            env,
        },
        params: {
            orders,
        },
        idempotencyKey,
    });
}

module.exports = {
    TRADING_ACTIONS,
    TRADING_PERMISSIONS,
    createTradingRequest,
    getTradingCommand,
    cancelOrder,
    cancelOrderBatch,
    publicTradingCommand,
    hasActionPermission,
    checkTargetAccess,
    validateOrderCreate,
    receiptStatusFromResult,
};
