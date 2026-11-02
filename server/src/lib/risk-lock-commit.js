/**
 * Protocol gắn reservation write với soft-lock fence.
 * Không dùng multi-doc transaction: renew → write → renew; mất fence sau write
 * thì orphan reservation (không còn ACTIVE) + enforce reject.
 */

/**
 * @param {{ preOk: boolean, postOk: boolean, mode: string, reservationId?: string|null }} input
 * @returns {{
 *   commitOk: boolean,
 *   allowed: boolean,
 *   orphan: boolean,
 *   reason: string,
 *   mode: string,
 * }}
 */
function decideCommitUnderFence({
    preOk,
    postOk,
    mode = "observe",
    reservationId = null,
} = {}) {
    if (!preOk) {
        return {
            commitOk: false,
            allowed: mode !== "enforce",
            orphan: false,
            reason: "lock_fenced_before_write",
            mode,
            reservationId,
        };
    }
    if (!postOk) {
        // Đã có thể ghi — orphan để không chiếm budget; enforce không cho entry
        return {
            commitOk: false,
            allowed: mode !== "enforce",
            orphan: Boolean(reservationId),
            reason: "lock_fenced_after_write",
            mode,
            reservationId,
        };
    }
    return {
        commitOk: true,
        allowed: true,
        orphan: false,
        reason: "ok",
        mode,
        reservationId,
    };
}

/**
 * Mô phỏng 2 worker: A ghi khi còn lock, B chiếm lease, A renew fail → orphan.
 * Pure — dùng cho regression (user mock writes:1 + lock_fenced_after).
 */
function simulateTwoWorkerFenceRace({
    mode = "enforce",
    writeWhileHolding = true,
} = {}) {
    let leaseOwner = null;
    let fence = 0;
    let writes = 0;
    let orphaned = false;
    const reservationId = "res-sim-1";

    function acquire(token) {
        fence += 1;
        leaseOwner = token;
        return { ok: true, fence, token };
    }
    function renew(token, expectFence) {
        if (leaseOwner !== token || fence !== expectFence) {
            return { ok: false, reason: "lock_fenced" };
        }
        return { ok: true };
    }

    const a = "worker-a";
    const b = "worker-b";
    const held = acquire(a);
    const pre = renew(a, held.fence);
    if (writeWhileHolding && pre.ok) {
        writes += 1;
    }
    // B chiếm sau khi A đã ghi
    acquire(b);
    const post = renew(a, held.fence);
    const decision = decideCommitUnderFence({
        preOk: pre.ok,
        postOk: post.ok,
        mode,
        reservationId: writes ? reservationId : null,
    });
    if (decision.orphan) orphaned = true;

    return {
        writes,
        orphaned,
        decision,
        result: {
            allowed: decision.allowed,
            mode,
            reason: decision.reason,
            reservationId: decision.reservationId,
        },
    };
}

module.exports = {
    decideCommitUnderFence,
    simulateTwoWorkerFenceRace,
};
