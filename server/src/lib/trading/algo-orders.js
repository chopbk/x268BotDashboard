const crypto = require("crypto");
const AlgoOrder = require("../../models/algo-order");
const { httpError } = require("../http");

function actorIdOf(actor) {
    return actor?.id || (actor?._id ? String(actor._id) : "");
}

function childOutstanding(child) {
    if (!["pending", "submitted", "unknown"].includes(child.status)) return 0;
    const qty = Number(child.quantity) || 0;
    const filled = Number(child.filledQty) || 0;
    return Math.max(0, qty - filled);
}

function publicAlgo(doc) {
    if (!doc) return null;
    const children = doc.children || [];
    const filledFromChildren = children.reduce((s, c) => s + (Number(c.filledQty) || 0), 0);
    const filled = Math.max(Number(doc.filledQty) || 0, filledFromChildren);
    const outstanding = children.reduce((s, c) => s + childOutstanding(c), 0);
    return {
        algoId: doc.algoId,
        account: doc.account,
        symbol: doc.symbol,
        type: doc.type,
        parentQuantity: doc.parentQuantity,
        filledQty: filled,
        outstandingQty: outstanding,
        remainingBound: doc.parentQuantity - filled - outstanding,
        status: doc.status,
        children: doc.children,
        liveExecution: Boolean(doc.liveExecution),
        reservationId: doc.reservationId || null,
        invariant: {
            fillsPlusOutstandingLteParent: filled + outstanding <= doc.parentQuantity + 1e-9,
        },
        note: doc.note,
    };
}

/**
 * Tạo parent algo — mặc định KHÔNG live execute (scheduler durable, dry).
 */
async function createAlgoOrder(actor, body = {}) {
    const actorId = actorIdOf(actor);
    const parentQuantity = Number(body.quantity ?? body.parentQuantity);
    if (!(parentQuantity > 0)) throw httpError(400, "Thiếu quantity");
    if (body.liveExecution === true) {
        throw httpError(400, "Live algo execution bị chặn trong milestone này", {
            code: "unsupported_capability",
        });
    }
    const type = String(body.type || "TWAP").toUpperCase();
    if (!["TWAP", "PARTICIPATION", "VWAP"].includes(type)) {
        throw httpError(400, "type algo không hỗ trợ");
    }
    if (type === "VWAP" && !body.volumeModel) {
        return {
            rejected: true,
            code: "data_unavailable",
            reason: "VWAP cần volume model — unavailable",
        };
    }

    const sliceCount = Math.min(50, Math.max(1, Number(body.slices) || 5));
    const sliceQty = parentQuantity / sliceCount;
    const children = [];
    for (let i = 0; i < sliceCount; i += 1) {
        children.push({
            childId: crypto.randomUUID(),
            status: "pending",
            quantity: sliceQty,
            filledQty: 0,
        });
    }

    const doc = await AlgoOrder.create({
        algoId: crypto.randomUUID(),
        actorId,
        account: String(body.account || body.username || "").trim(),
        symbol: String(body.symbol || "").toUpperCase(),
        side: body.side,
        positionSide: body.positionSide,
        type,
        parentQuantity,
        filledQty: 0,
        outstandingQty: 0,
        status: "draft",
        params: {
            slices: sliceCount,
            maxDurationMs: body.maxDurationMs,
            maxDeviationBps: body.maxDeviationBps,
            participationRate: body.participationRate,
            volumeModel: body.volumeModel || null,
        },
        children,
        reservationId: body.reservationId || null,
        liveExecution: false,
        maxDurationMs: body.maxDurationMs,
        maxDeviationBps: body.maxDeviationBps,
        note: "Durable parent/child — reconcile trước gửi child; browser đóng không mất state",
    });
    return { algo: publicAlgo(doc) };
}

async function getAlgoOrder(actor, algoId) {
    const doc = await AlgoOrder.findOne({ algoId, actorId: actorIdOf(actor) });
    if (!doc) throw httpError(404, "Không tìm thấy algo");
    return publicAlgo(doc);
}

async function pauseAlgo(actor, algoId) {
    const doc = await AlgoOrder.findOne({ algoId, actorId: actorIdOf(actor) });
    if (!doc) throw httpError(404, "Không tìm thấy algo");
    if (doc.status === "completed" || doc.status === "cancelled") {
        return publicAlgo(doc);
    }
    doc.status = "paused";
    await doc.save();
    return publicAlgo(doc);
}

async function cancelAlgo(actor, algoId) {
    const doc = await AlgoOrder.findOne({ algoId, actorId: actorIdOf(actor) });
    if (!doc) throw httpError(404, "Không tìm thấy algo");
    const unknown = (doc.children || []).some((c) => c.status === "unknown" || c.status === "submitted");
    doc.status = unknown ? "cancelling" : "cancelled";
    for (const child of doc.children) {
        if (child.status === "pending") child.status = "cancelled";
    }
    await doc.save();
    return {
        algo: publicAlgo(doc),
        done: doc.status === "cancelled",
        note: unknown
            ? "Không báo done khi còn child unknown/submitted — cần reconcile"
            : "cancelled",
    };
}

/**
 * Reconcile sau restart — không gửi child mới nếu pause / bound vượt.
 */
async function reconcileAlgo(actor, algoId, { exchangeChildren = [] } = {}) {
    const doc = await AlgoOrder.findOne({ algoId, actorId: actorIdOf(actor) });
    if (!doc) throw httpError(404, "Không tìm thấy algo");

    let filled = 0;
    for (const child of doc.children) {
        const ex = exchangeChildren.find((e) => e.childId === child.childId || e.exchangeOrderId === child.exchangeOrderId);
        if (ex) {
            child.status = ex.status || child.status;
            child.filledQty = Number(ex.filledQty) || child.filledQty || 0;
            child.exchangeOrderId = ex.exchangeOrderId || child.exchangeOrderId;
        }
        filled += Number(child.filledQty) || 0;
    }
    doc.filledQty = filled;
    const outstanding = doc.children
        .filter((c) => ["pending", "submitted", "unknown"].includes(c.status))
        .reduce((s, c) => s + (Number(c.quantity) || 0), 0);
    if (filled + outstanding > doc.parentQuantity + 1e-6) {
        doc.status = "paused";
        doc.note = "bound_exceeded_pause_new_children";
    }
    await doc.save();
    return publicAlgo(doc);
}

/** Depth/tape capability — explicit unavailable khi thiếu provider. */
function microstructureCapabilities() {
    return {
        orderBook: { available: false, reason: "provider_unavailable" },
        tape: { available: false, reason: "provider_unavailable" },
        cvd: { available: false, reason: "requires_classified_trades" },
        footprint: { available: false, reason: "requires_classified_trades" },
        volumeProfile: { available: false, reason: "source_missing" },
        liquidationObserved: { available: false, reason: "provider_unavailable" },
        liquidationHeatmapEstimated: { available: false, reason: "not_fabricated" },
        backlog: true,
    };
}

module.exports = {
    createAlgoOrder,
    getAlgoOrder,
    pauseAlgo,
    cancelAlgo,
    reconcileAlgo,
    publicAlgo,
    microstructureCapabilities,
};
