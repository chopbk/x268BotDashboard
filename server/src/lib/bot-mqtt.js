const mqtt = require("mqtt");
const MqttConfig = require("../models/mqtt-config");
const config = require("../config");

const CONFIG_SYNC_TOPIC = "config/sync";
const NEW_COMMAND_TOPIC = "new_command";
const COMMAND_RESPONSE_TOPIC = "command_response";

let client = null;
let starting = null;
const responseHandlers = new Set();

function mqttEnv() {
    return String(config.mqttEnv || process.env.MQTT || "DEFAULT").trim() || "DEFAULT";
}

async function loadBrokerUrl() {
    if (config.mqttUrl) return config.mqttUrl;
    const env = mqttEnv();
    let row = await MqttConfig.findOne({ env }).select("url").lean();
    if (!row?.url) {
        row = await MqttConfig.findOne({ env: "DEFAULT" }).select("url").lean();
    }
    if (!row?.url) {
        throw new Error(`[bot-mqtt] thiếu mqtt_configs.url cho env=${env}`);
    }
    return row.url;
}

function onResponse(handler) {
    responseHandlers.add(handler);
    return () => responseHandlers.delete(handler);
}

async function startBotMqtt() {
    if (client?.connected) return client;
    if (starting) return starting;
    starting = (async () => {
        try {
            const url = await loadBrokerUrl();
            await new Promise((resolve, reject) => {
                const next = mqtt.connect(url, {
                    reconnectPeriod: 5_000,
                    connectTimeout: 15_000,
                });
                const onError = (err) => {
                    console.error("[bot-mqtt] connect error", err?.message || err);
                    next.removeListener("connect", onConnect);
                    reject(err);
                };
                const onConnect = () => {
                    next.removeListener("error", onError);
                    next.subscribe(COMMAND_RESPONSE_TOPIC, { qos: 1 }, (err) => {
                        if (err) {
                            console.error("[bot-mqtt] subscribe command_response", err.message);
                        } else {
                            console.log("[bot-mqtt] subscribed", COMMAND_RESPONSE_TOPIC);
                        }
                    });
                    resolve();
                };
                next.once("error", onError);
                next.once("connect", onConnect);
                next.on("message", (topic, buf) => {
                    if (topic !== COMMAND_RESPONSE_TOPIC) return;
                    let payload;
                    try {
                        payload = JSON.parse(buf.toString());
                    } catch (error) {
                        console.warn("[bot-mqtt] invalid command_response JSON", error.message);
                        return;
                    }
                    for (const handler of responseHandlers) {
                        try {
                            handler(payload);
                        } catch (error) {
                            console.error("[bot-mqtt] response handler", error.message);
                        }
                    }
                });
                next.on("error", (err) => {
                    console.error("[bot-mqtt] error", err?.message || err);
                });
                next.on("reconnect", () => {
                    console.log("[bot-mqtt] reconnecting");
                });
                client = next;
            });
            return client;
        } catch (error) {
            console.error("[bot-mqtt] start failed", error.message);
            client = null;
            throw error;
        } finally {
            starting = null;
        }
    })();
    return starting;
}

function isConnected() {
    return !!(client && client.connected);
}

function publishJson(topic, data, { qos = 1 } = {}) {
    return new Promise((resolve, reject) => {
        if (!client?.connected) {
            reject(new Error("MQTT chưa kết nối"));
            return;
        }
        const body = JSON.stringify(data);
        client.publish(topic, body, { qos }, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function publishConfigSync(payload) {
    await startBotMqtt().catch(() => {});
    return publishJson(CONFIG_SYNC_TOPIC, payload, { qos: 1 });
}

async function publishNewCommand(payload) {
    await startBotMqtt().catch(() => {});
    return publishJson(NEW_COMMAND_TOPIC, payload, { qos: 1 });
}

module.exports = {
    CONFIG_SYNC_TOPIC,
    NEW_COMMAND_TOPIC,
    COMMAND_RESPONSE_TOPIC,
    startBotMqtt,
    isConnected,
    onResponse,
    publishConfigSync,
    publishNewCommand,
};
