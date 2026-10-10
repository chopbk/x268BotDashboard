/**
 * Pure helpers cho outbox status / role ACK — dễ unit test, không đụng Mongo.
 */

const TERMINAL = Object.freeze(new Set(["succeeded", "failed", "expired"]));

const STATUS_RANK = Object.freeze({
    queued: 0,
    published: 1,
    received: 2,
    running: 3,
    succeeded: 4,
    failed: 4,
    expired: 4,
});

function mapOutboxStatus(mqttStatus) {
    if (mqttStatus === "received") return "received";
    if (mqttStatus === "running") return "running";
    if (mqttStatus === "succeeded") return "succeeded";
    if (mqttStatus === "failed") return "failed";
    return null;
}

/**
 * Không cho status đi lùi. Terminal không đổi.
 * failed/expired/succeeded luôn được chấp nhận từ non-terminal.
 */
function resolveStatusTransition(currentStatus, nextStatus) {
    const current = String(currentStatus || "queued");
    const next = nextStatus ? String(nextStatus) : null;
    if (!next) {
        return { status: current, accepted: false, regress: false };
    }
    if (TERMINAL.has(current)) {
        return { status: current, accepted: false, regress: false };
    }
    if (next === "failed" || next === "expired" || next === "succeeded") {
        return { status: next, accepted: true, regress: false };
    }
    const curRank = STATUS_RANK[current] ?? -1;
    const nextRank = STATUS_RANK[next] ?? -1;
    if (nextRank < curRank) {
        return { status: current, accepted: false, regress: true };
    }
    return { status: next, accepted: true, regress: false };
}

/**
 * Tổng hợp role ACKs → overall status/terminal.
 * requiredRoles phải đều terminal; bất kỳ failed → failed; tất cả succeeded → succeeded.
 */
function evaluateRoleAcks(requiredRoles, roleAcks) {
    const required = Array.isArray(requiredRoles) && requiredRoles.length ? requiredRoles : ["TRADER"];
    const acks = roleAcks && typeof roleAcks === "object" ? roleAcks : {};
    let allTerminal = true;
    let anyFailed = false;
    let anyRunning = false;
    let anyReceived = false;
    let anySucceeded = false;

    for (const role of required) {
        const ack = acks[role] || acks.get?.(role);
        if (!ack) {
            allTerminal = false;
            continue;
        }
        if (ack.status === "failed") anyFailed = true;
        if (ack.status === "succeeded") anySucceeded = true;
        if (ack.status === "running") anyRunning = true;
        if (ack.status === "received") anyReceived = true;
        if (!ack.terminal) allTerminal = false;
    }

    if (allTerminal) {
        if (anyFailed) return { status: "failed", terminal: true };
        return { status: "succeeded", terminal: true };
    }
    if (anyFailed && required.every((role) => {
        const ack = acks[role] || acks.get?.(role);
        return ack?.terminal;
    })) {
        return { status: "failed", terminal: true };
    }
    if (anyRunning) return { status: "running", terminal: false };
    if (anyReceived || anySucceeded) return { status: "received", terminal: false };
    return { status: null, terminal: false };
}

/**
 * targetEnv phải nằm trong applied mới coi role succeeded (khi requireApplied).
 */
function roleTerminalFromPayload(payload, targetEnv, { requireApplied = false } = {}) {
    const status = mapOutboxStatus(payload?.status);
    if (!status) return null;
    const env = String(targetEnv || "").toUpperCase();
    const applied = Array.isArray(payload?.applied)
        ? payload.applied.map((e) => String(e).toUpperCase())
        : [];
    if (requireApplied && status === "succeeded" && payload?.terminal === true) {
        if (!env || !applied.includes(env)) {
            return {
                status: "failed",
                terminal: true,
                message: `ACK succeeded nhưng ${env || "?"} không nằm trong applied`,
                error: { code: "ACK_MISSING_TARGET", message: `${env} not in applied` },
            };
        }
    }
    return {
        status,
        terminal: payload?.terminal === true || TERMINAL.has(status),
        message: payload?.message,
        error: payload?.error || null,
    };
}

module.exports = {
    TERMINAL,
    STATUS_RANK,
    mapOutboxStatus,
    resolveStatusTransition,
    evaluateRoleAcks,
    roleTerminalFromPayload,
};
