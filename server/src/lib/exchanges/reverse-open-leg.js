/**
 * Sau khi close xong reverse: gate open-leg không được nuốt mất closeResult.
 * allowed:false hoặc throw → partial { closeOk, openBlocked }.
 */
async function guardOpenLegAfterClose(beforeOpen, ctx = {}) {
    if (typeof beforeOpen !== "function") {
        return { proceed: true };
    }
    let gate;
    try {
        gate = await beforeOpen(ctx);
    } catch (error) {
        return {
            proceed: false,
            partial: true,
            closeOk: true,
            openBlocked: true,
            gateError: true,
            reason: error?.message || "open_leg_gate_error",
        };
    }
    if (gate && gate.allowed === false) {
        return {
            proceed: false,
            partial: true,
            closeOk: true,
            openBlocked: true,
            gateError: false,
            reason: gate.reason || "risk_rejected",
            gate,
        };
    }
    return { proceed: true, gate };
}

module.exports = { guardOpenLegAfterClose };
