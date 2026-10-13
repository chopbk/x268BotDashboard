const mongoose = require("mongoose");

/**
 * Ghi chú cá nhân gắn tradeKey (account|symbol|side).
 * Chỉ actor tạo mới xem/sửa/xoá — không ghi vào stats bot.
 */
const tradeJournalSchema = new mongoose.Schema(
    {
        actorId: { type: String, required: true, index: true },
        tradeKey: { type: String, required: true, index: true },
        account: { type: String, required: true },
        symbol: { type: String, required: true },
        side: { type: String, required: true },
        body: { type: String, required: true, maxlength: 2000 },
        tags: {
            type: [String],
            default: [],
            validate: {
                validator(value) {
                    if (!Array.isArray(value) || value.length > 10) return false;
                    return value.every((tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 30);
                },
                message: "Tối đa 10 tags, mỗi tag ≤ 30 ký tự",
            },
        },
    },
    { timestamps: true, collection: "web_trade_journal" }
);

tradeJournalSchema.index({ actorId: 1, tradeKey: 1, createdAt: -1 });

module.exports = mongoose.models.TradeJournal || mongoose.model("TradeJournal", tradeJournalSchema);
