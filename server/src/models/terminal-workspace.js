const mongoose = require("mongoose");

/**
 * Terminal workspace prefs per actor — layout/watchlist/drawings.
 * Collection: web_terminal_workspaces
 */
const TerminalWorkspaceSchema = new mongoose.Schema(
    {
        actorId: { type: String, required: true, unique: true },
        revision: { type: Number, required: true, default: 1 },
        layout: {
            chartHeight: { type: Number, default: 280 },
            showWatchlist: { type: Boolean, default: true },
            showChart: { type: Boolean, default: true },
            chartCollapsed: { type: Boolean, default: false },
        },
        watchlist: {
            type: [{
                exchange: { type: String, default: "binance" },
                marketType: { type: String, default: "usdt_perp_linear" },
                instrumentId: String,
                symbol: String,
            }],
            default: [],
        },
        timeframe: { type: String, default: "15m" },
        drawings: {
            type: [{
                marketKey: String,
                kind: { type: String, enum: ["hline", "trendline", "zone"] },
                points: [Number],
                label: String,
                color: String,
            }],
            default: [],
        },
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_terminal_workspaces",
    }
);

module.exports = mongoose.models.TerminalWorkspace
    || mongoose.model("TerminalWorkspace", TerminalWorkspaceSchema);
