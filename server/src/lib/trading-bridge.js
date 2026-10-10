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
const BotCommand = require("../models/bot-command");
const TradingReceipt = require("../models/trading-receipt");
const UserAccount = require("../models/user-account");
const { startBotMqtt, publishTradingRequest, onTradingResponse, isConnected } = require("./bot-mqtt");

const DEFAULT_TTL_MS = 30_000;
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
        requiredFields: ["closeOrderType", "openOrderType", "newQuantity"],
        validate: validatePositionReverse,
    },
    ORDER_CREATE: {
        permission: "orders.create",
        requiredFields: ["kind", "side", "positionSide", "type", "quantity"],
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
    // Phase C implementation
    return { valid: true, normalized: params };
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
    return { valid: true, normalized: params };
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
    // Phase F implementation
    return { valid: true, normalized: params };
}

function validateOrderCreate(params) {
    // Phase E+ implementation
    return { valid: true, normalized: params };
}

function validateOrderReplace(params) {
    // Phase F implementation
    return { valid: true, normalized: params };
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
 * Tạo trading request và gửi qua MQTT.
 */
async function createTradingRequest({
    actor,
    action,
    target,
    params,
    expected,
    idempotencyKey,
    ttlMs = DEFAULT_TTL_MS,
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

    // Generate IDs
    const requestId = crypto.randomUUID();
    const finalIdempotencyKey = idempotencyKey || requestId;
    const actorUserId = actor?.id || (actor?._id ? String(actor._id) : "");

    // Check idempotency
    const idempCheck = await checkIdempotency(actorUserId, finalIdempotencyKey);
    if (idempCheck.duplicate) {
        // Return existing receipt
        return {
            duplicate: true,
            command: publicTradingCommand(idempCheck.receipt),
        };
    }

    const now = Date.now();
    const expiresAt = new Date(now + ttlMs);

    // Create outbox entry
    const command = await BotCommand.create({
        requestId,
        username: target.username,
        targetEnv: target.env || "",
        action,
        params: {
            ...validation.normalized,
            target,
            expected,
        },
        category: "trading",
        status: "queued",
        terminal: false,
        requiredRoles: ["TRADER"],
        roleAcks: {},
        actorUserId,
        actorUsername: actor?.username || actor?.email || "",
        expiresAt,
        attempt: 1,
        messages: [],
        idempotencyKey: finalIdempotencyKey,
    });

    // Create receipt for durable idempotency
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
        status: "claimed",
        actorUserId,
        actorUsername: actor?.username || actor?.email || "",
        expiresAt: new Date(now + IDEMPOTENCY_WINDOW_MS),
    });

    // Publish to MQTT
    const published = await publishTradingCommand(command, target, validation.normalized, expected, expiresAt);

    return {
        duplicate: false,
        command: publicTradingCommand(published),
    };
}

/**
 * Publish trading command to MQTT.
 */
async function publishTradingCommand(doc, target, params, expected, expiresAt) {
    const requestId = doc.requestId;

    try {
        await startBotMqtt();
    } catch (error) {
        await BotCommand.updateOne(
            { requestId, terminal: false },
            {
                $set: {
                    status: "failed",
                    terminal: true,
                    error: { code: "MQTT_CONNECT", message: error.message },
                },
                $push: {
                    messages: {
                        status: "failed",
                        message: error.message,
                        error: { code: "MQTT_CONNECT", message: error.message },
                        timestamp: Date.now(),
                        at: new Date(),
                    },
                },
            }
        );
        await TradingReceipt.updateOne(
            { requestId },
            { $set: { status: "failed", error: { code: "MQTT_CONNECT", message: error.message } } }
        );
        return BotCommand.findOne({ requestId });
    }

    const publishedAt = new Date();
    await BotCommand.updateOne(
        { requestId, terminal: false, status: "queued" },
        {
            $set: { status: "published", publishedAt },
            $push: {
                messages: {
                    status: "published",
                    message: "Đã gửi MQTT trading request",
                    error: null,
                    timestamp: Date.now(),
                    at: publishedAt,
                },
            },
        }
    );

    try {
        const payload = {
            version: 1,
            requestId,
            idempotencyKey: doc.idempotencyKey || requestId,
            action: doc.action,
            actor: {
                webUserId: doc.actorUserId,
                username: doc.actorUsername,
            },
            target,
            params,
            expected: expected || {},
            createdAt: Date.now(),
            expiresAt: expiresAt.getTime(),
        };

        await publishTradingRequest(payload);
    } catch (error) {
        await BotCommand.updateOne(
            { requestId, terminal: false },
            {
                $set: {
                    status: "failed",
                    terminal: true,
                    error: { code: "MQTT_PUBLISH", message: error.message },
                },
                $push: {
                    messages: {
                        status: "failed",
                        message: error.message,
                        error: { code: "MQTT_PUBLISH", message: error.message },
                        timestamp: Date.now(),
                        at: new Date(),
                    },
                },
            }
        );
        await TradingReceipt.updateOne(
            { requestId },
            { $set: { status: "failed", error: { code: "MQTT_PUBLISH", message: error.message } } }
        );
    }

    return BotCommand.findOne({ requestId });
}

/**
 * Public command shape cho response.
 */
function publicTradingCommand(doc) {
    if (!doc) return null;
    return {
        requestId: doc.requestId,
        idempotencyKey: doc.idempotencyKey,
        username: doc.username || doc.target?.username,
        action: doc.action,
        status: doc.status,
        terminal: !!doc.terminal,
        error: doc.error || null,
        result: doc.result || null,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

/**
 * Get trading command status.
 */
async function getTradingCommand(actor, requestId) {
    const doc = await BotCommand.findOne({
        requestId: String(requestId || ""),
        category: "trading",
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
        await checkTargetAccess(actor, doc.username, doc.action).catch(() => {
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
};
