const crypto = require("crypto");
const RiskPolicy = require("../models/risk-policy");
const { upsertPolicy, getPolicyForAccount } = require("./risk-policy");
const { httpError } = require("./http");

/**
 * Ba control độc lập:
 * - pause_new_entries: set policy.limits.pauseNewEntries (không dừng monitor)
 * - cancel_pending_entry_orders: trả danh sách target (caller/trading thực hiện cancel; không cancel SL/TP)
 * - flatten: trả danh sách vị thế scope (caller đóng; không cancel-all khi sibling)
 */
async function runRiskControl(actor, body = {}) {
    const type = String(body.type || "").trim();
    const username = String(body.username || "").trim();
    if (!username) throw httpError(400, "Thiếu username");
    if (!["pause_new_entries", "resume_new_entries", "cancel_pending_entry_orders", "flatten"].includes(type)) {
        throw httpError(400, "type control không hợp lệ");
    }

    const controlId = crypto.randomUUID();
    if (type === "pause_new_entries" || type === "resume_new_entries") {
        const policy = await getPolicyForAccount(username);
        const next = await upsertPolicy(actor, {
            policyId: policy?.policyId,
            username,
            expectedRevision: policy?.revision,
            mode: policy?.mode || "observe",
            limits: {
                ...(policy?.limits || {}),
                pauseNewEntries: type === "pause_new_entries",
            },
        });
        return {
            controlId,
            type,
            status: "applied",
            policy: next,
            note: type === "pause_new_entries"
                ? "Pause entry only — monitor/SL/TP tiếp tục"
                : "Resume new entries",
            targets: [],
        };
    }

    if (type === "cancel_pending_entry_orders") {
        const orders = Array.isArray(body.openOrders) ? body.openOrders : [];
        const targets = orders.filter((o) => {
            if (o.reduceOnly === true) return false;
            const t = String(o.type || o.orderType || "").toUpperCase();
            if (t.includes("STOP") && (o.closePosition === true || o.positionSide)) {
                // Heuristic: algo closePosition / protection → không hủy
                if (o.closePosition === true || o.kind === "algo" && /SL|TP|STOP_MARKET|TAKE_PROFIT/.test(t)) {
                    return false;
                }
            }
            if (["STOP_MARKET", "TAKE_PROFIT_MARKET", "STOP", "TAKE_PROFIT"].includes(t) && o.reduceOnly !== false) {
                // Keep protection unless explicitly entry
                if (body.includeProtection !== true) return false;
            }
            return true;
        }).map((o) => ({
            orderId: o.orderId || o.algoId,
            symbol: o.symbol,
            kind: o.kind || "regular",
            type: o.type,
            reason: "pending_entry_candidate",
        }));
        return {
            controlId,
            type,
            status: "preview",
            note: "Không tự cancel — client/trading path phải gọi orders.cancel từng lệnh; không cancel SL/TP mặc định",
            targets,
            requiresPermission: "orders.cancel",
        };
    }

    // flatten
    const positions = Array.isArray(body.positions) ? body.positions : [];
    const symbolFilter = body.symbol ? String(body.symbol).toUpperCase() : null;
    const targets = positions
        .filter((p) => !symbolFilter || String(p.symbol).toUpperCase() === symbolFilter)
        .map((p) => ({
            account: username,
            symbol: p.symbol,
            side: p.side || p.positionSide,
            exchangeQty: p.qty ?? p.positionAmt,
            ownQtyHint: (p.monitors || []).map((m) => ({ env: m.env, ownQty: m.ownQty })),
            hasSibling: (p.monitors || []).length > 1,
            note: (p.monitors || []).length > 1
                ? "Có sibling — không cancel-all symbol; đóng theo qty own/exchange đã chọn"
                : "Flatten candidate",
        }));
    return {
        controlId,
        type: "flatten",
        status: "preview",
        note: "Không tự đóng — cần positions.close từng target; giữ sibling/leftover invariant",
        targets,
        requiresPermission: "positions.close",
    };
}

module.exports = { runRiskControl };
