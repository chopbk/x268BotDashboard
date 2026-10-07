const mongoose = require("mongoose");

const INDEXES = Object.freeze([
    ["account_statics", { env: 1, isPaper: 1, openTime: 1 }, "summary_env_paper_open"],
    ["futures_profits", { env: 1, day: 1 }, "summary_env_day"],
    ["monitor_positions", { env: 1, closed: 1 }, "summary_env_closed"],
    ["signal_infos", { openTime: 1 }, "summary_open_time"],
    ["web_summary_snapshots", { status: 1, staleAt: 1 }, "summary_status_stale"],
]);

async function ensureSummaryIndexes() {
    for (const [collection, keys, name] of INDEXES) {
        await mongoose.connection.collection(collection).createIndex(keys, { name });
    }
}

module.exports = { INDEXES, ensureSummaryIndexes };
