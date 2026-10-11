/**
 * Request data refresh từ binance-bot qua MQTT.
 * binance-bot sẽ gọi Binance API và ghi vào Redis.
 */
const crypto = require("crypto");
const { onDataResponse, publishDataRequest, isConnected, startBotMqtt } = require("./bot-mqtt");

const TIMEOUT_MS = 8_000; // 8s đủ cho binance-bot xử lý, không chờ lâu

/**
 * Gửi request refresh positions cho một account.
 * @param {string} account - Tên account (env) cần refresh
 * @returns {Promise<{status: string, result?: object, error?: string}>}
 */
async function requestPositionRefresh(account) {
    // Không tự động connect MQTT - chỉ dùng nếu đã connected
    if (!isConnected()) {
        throw new Error("MQTT chưa kết nối");
    }

    const requestId = crypto.randomUUID();
    const request = {
        requestId,
        action: "refresh_positions",
        target: { account },
        timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
        let unsubscribe;
        const timer = setTimeout(() => {
            if (unsubscribe) unsubscribe();
            reject(new Error("Timeout chờ phản hồi từ binance-bot"));
        }, TIMEOUT_MS);

        unsubscribe = onDataResponse((payload) => {
            if (payload.requestId !== requestId) return;
            clearTimeout(timer);
            unsubscribe();
            if (payload.status === "succeeded") {
                resolve({ status: "succeeded", result: payload.result });
            } else {
                resolve({ status: "failed", error: payload.error || "Unknown error" });
            }
        });

        publishDataRequest(request).catch((error) => {
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
            reject(error);
        });
    });
}

module.exports = {
    requestPositionRefresh,
    TIMEOUT_MS,
};
