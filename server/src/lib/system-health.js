const mongoose = require("mongoose");
const ProcessHeartbeat = require("../models/process-heartbeat");
const MonitorPosition = require("../models/monitor-position");
const RuntimeLog = require("../models/runtime-log");
const SummarySnapshot = require("../models/summary-snapshot");
const config = require("../config");
const { rateLimitStoreStatus } = require("./rate-limit-store");
const { FORMULA_VERSION } = require("./summary-snapshots");

const STALE_MS = 90 * 1000;
const CREDENTIAL_MS = 30 * 60 * 1000;

function age(at, now) {
    const time = new Date(at).getTime();
    return Number.isFinite(time) ? now - time : null;
}

function fresh(row, now) {
    const elapsed = age(row?.at, now);
    return elapsed != null && elapsed <= STALE_MS;
}

function service(id, label, status, detail, at) {
    return { id, label, status, detail, at: at || null };
}

function currentSnapshots(rows) {
    const byRange = new Map();
    for (const row of rows || []) {
        if (row?.formulaVersion && row.formulaVersion !== FORMULA_VERSION) continue;
        const id = String(row?._id || "");
        if (!row?.formulaVersion && id && !id.startsWith(`${FORMULA_VERSION}:`)) continue;
        const key = row?.range || id;
        if (!key) continue;
        const prev = byRange.get(key);
        const at = new Date(row?.generatedAt || 0).getTime();
        const prevAt = new Date(prev?.generatedAt || 0).getTime();
        if (!prev || at >= prevAt) byRange.set(key, row);
    }
    return [...byRange.values()];
}

function assessHealth(input = {}) {
    const now = input.now instanceof Date ? input.now.getTime() : Date.now();
    const beats = Array.isArray(input.heartbeats) ? input.heartbeats : [];
    const alerts = [];
    const processes = beats.map((row) => {
        const online = fresh(row, now);
        let status = online ? "ok" : "down";
        if (online && row.flags?.trader && row.mqttConnected === false) status = "warn";
        if (online && row.flags?.listener && row.mqttConnected === false) status = "warn";
        return { ...publicBeat(row), status, ageMs: age(row.at, now) };
    });

    for (const row of processes) {
        const name = row.processName || row.key;
        if (row.flags?.listener && row.status === "down") {
            alerts.push({ level: "warn", code: "listener", message: `Listener ${name} mất heartbeat` });
        }
        if (row.flags?.trader && row.status !== "down" && row.mqttConnected === false) {
            alerts.push({ level: "warn", code: "mqtt", message: `Trader ${name} không nhận MQTT` });
        }
        if (row.flags?.monitor && row.status === "down") {
            alerts.push({ level: "warn", code: "monitor", message: `Monitor ${name} không heartbeat` });
        }
    }

    const redis = input.redis === "redis" ? "redis" : "memory";
    if (input.redisConfigured && redis === "memory") {
        alerts.push({ level: "warn", code: "redis", message: "Redis fallback về memory" });
    }
    for (const snap of currentSnapshots(input.snapshots)) {
        const stale = snap.staleAt && new Date(snap.staleAt).getTime() <= now;
        if (snap.status === "error" || stale) {
            alerts.push({
                level: "warn",
                code: "snapshot",
                message: `Snapshot ${snap.range || ""} ${snap.status === "error" ? "lỗi" : "quá hạn"}${snap.lastError ? `: ${String(snap.lastError).slice(0, 160)}` : ""}`,
            });
        }
    }
    const unmonitored = Number(input.unmonitored) || 0;
    if (unmonitored > 0) {
        alerts.push({ level: "warn", code: "position", message: `${unmonitored} position không được monitor` });
    }
    for (const row of input.credentials || []) {
        alerts.push({ level: "warn", code: "credential", message: `Credential: ${String(row.message || "").slice(0, 180)}` });
    }

    const listeners = processes.filter((row) => row.flags?.listener);
    const traders = processes.filter((row) => row.flags?.trader);
    const monitors = processes.filter((row) => row.flags?.monitor);
    const telegram = listeners.filter((row) => row.teleClient);
    const services = [
        service("mongo", "MongoDB", input.mongoOk === false ? "down" : "ok", input.mongoOk === false ? "Mất kết nối" : "Đang kết nối"),
        service("redis", "Redis", !input.redisConfigured ? "off" : redis === "redis" ? "ok" : "warn", !input.redisConfigured ? "Không cấu hình" : redis),
        service("mqtt", "MQTT broker", beatStatus(processes.filter((row) => row.mqtt)), processes.some((row) => row.mqttConnected) ? "Có client đang nối" : "Không thấy client nối"),
        service("telegram-v1", "Telegram listener V1", beatStatus(telegram.filter((row) => row.teleVersion !== "2")), countDetail(telegram.filter((row) => row.teleVersion !== "2"))),
        service("telegram-v2", "Telegram listener V2", beatStatus(telegram.filter((row) => row.teleVersion === "2")), countDetail(telegram.filter((row) => row.teleVersion === "2"))),
        service("discord", "Discord listener", beatStatus(listeners.filter((row) => row.discord)), countDetail(listeners.filter((row) => row.discord))),
        service("trader", "Trader", beatStatus(traders), countDetail(traders)),
        service("monitor", "Monitor", beatStatus(monitors), countDetail(monitors)),
        service("signal", "Signal scanner", beatStatus(processes.filter((row) => row.flags?.signal)), countDetail(processes.filter((row) => row.flags?.signal))),
        service("dca", "DCA/MTF bot", beatStatus(processes.filter((row) => row.flags?.dca)), countDetail(processes.filter((row) => row.flags?.dca))),
        service("poster", "Poster/webhook", beatStatus(processes.filter((row) => row.flags?.poster || row.flags?.webhook)), countDetail(processes.filter((row) => row.flags?.poster || row.flags?.webhook))),
        service("pm2", "PM2 process", processes.length ? (processes.some((row) => row.status === "down") ? "warn" : "ok") : "off", processes.length ? `${processes.filter((row) => row.status !== "down").length}/${processes.length} heartbeat` : "Chưa có heartbeat"),
    ];
    return { services, processes, alerts };
}

function beatStatus(rows) {
    if (!rows.length) return "off";
    if (rows.every((row) => row.status === "down")) return "down";
    if (rows.some((row) => row.status !== "ok")) return "warn";
    return "ok";
}

function countDetail(rows) {
    if (!rows.length) return "Không chạy";
    return rows.map((row) => row.processName || row.key).join(", ");
}

function publicBeat(row) {
    return {
        key: row.key,
        processName: row.processName || "",
        pmId: row.pmId || "",
        pid: row.pid || null,
        host: row.host || "",
        roles: row.roles || [],
        run: row.run || [],
        nodeEnv: row.nodeEnv || "",
        mqtt: row.mqtt || "",
        tele: row.tele || "",
        teleClient: row.teleClient || "",
        teleVersion: row.teleVersion || "",
        discord: row.discord || "",
        flags: row.flags || {},
        mqttConnected: row.mqttConnected === true ? true : row.mqttConnected === false ? false : null,
        memoryMb: row.memoryMb ?? null,
        cpuPercent: row.cpuPercent ?? null,
        restarts: row.restarts ?? null,
        at: row.at || null,
    };
}

async function loadSystemHealth() {
    const now = new Date();
    const mongoOk = mongoose.connection.readyState === 1;
    const [heartbeats, unmonitored, snapshots, credentials] = await Promise.all([
        ProcessHeartbeat.find({}).sort({ processName: 1 }).lean(),
        MonitorPosition.countDocuments({ closed: { $ne: true }, type: "NOTPSL", isPaper: { $ne: true } }),
        SummarySnapshot.find({}).select("range status staleAt lastError generatedAt").lean(),
        RuntimeLog.find({ category: "exchange", at: { $gte: new Date(now.getTime() - CREDENTIAL_MS) } })
            .select("message at")
            .sort({ at: -1 })
            .limit(8)
            .lean(),
    ]);
    const health = assessHealth({
        now,
        heartbeats,
        mongoOk,
        redis: rateLimitStoreStatus(),
        redisConfigured: !!config.redisUrl,
        snapshots,
        unmonitored,
        credentials: credentials.filter((row) => /invalid api|api-key|api key|signature|credential|-2014|-2015/i.test(row.message || "")),
    });
    return { checkedAt: now.toISOString(), staleMs: STALE_MS, ...health };
}

module.exports = { assessHealth, loadSystemHealth, currentSnapshots, STALE_MS };
