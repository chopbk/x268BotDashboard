/**
 * Phân tích yếu tố vị thế mở + gợi ý rule-based (fallback khi chưa cấu hình AI).
 */

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function pctMove(from, to) {
    const a = num(from);
    const b = num(to);
    if (a == null || a === 0 || b == null) return null;
    return ((b - a) / Math.abs(a)) * 100;
}

function adverseDistancePct(side, mark, level) {
    const m = num(mark);
    const l = num(level);
    if (m == null || m <= 0 || l == null || l <= 0) return null;
    const s = String(side || "").toUpperCase();
    if (s === "LONG") return ((m - l) / m) * 100;
    if (s === "SHORT") return ((l - m) / m) * 100;
    return null;
}

function collectFactors(row = {}) {
    const side = String(row.side || "").toUpperCase();
    const entry = num(row.entry);
    const mark = num(row.mark);
    const qty = num(row.size ?? row.positionAmt ?? row.qty);
    const unrealized = num(row.unrealized);
    const leverage = num(row.leverage);
    const liq = num(row.liquidation);
    const sl = num(row.exchangeSl ?? row.sl);
    const tp = num(row.exchangeTp ?? row.tp);
    const movePct = pctMove(entry, mark);
    const moveForSide = movePct == null ? null : (side === "SHORT" ? -movePct : movePct);
    const slDist = adverseDistancePct(side, mark, sl);
    const tpDist = adverseDistancePct(side === "LONG" ? "SHORT" : "LONG", mark, tp);
    const liqDist = adverseDistancePct(side, mark, liq);
    const notional = qty != null && mark != null ? Math.abs(qty) * mark : null;
    const marginEst = notional != null && leverage ? notional / leverage : null;
    const roiEst = unrealized != null && marginEst ? (unrealized / marginEst) * 100 : null;

    return {
        account: row.account || null,
        symbol: row.symbol || null,
        side: side || null,
        book: row.book || null,
        entry,
        mark,
        qty,
        unrealized,
        leverage,
        liquidation: liq,
        sl,
        tp,
        movePct: moveForSide,
        slDistancePct: slDist,
        tpDistancePct: tpDist,
        liqDistancePct: liqDist,
        notional,
        marginEst,
        roiEst,
        protection: {
            hasSl: sl != null,
            hasTp: tp != null,
            slKind: row.slKind || null,
            tpKind: row.tpKind || null,
        },
        ownership: row.ownership || null,
        monitors: Array.isArray(row.monitors)
            ? row.monitors.map((m) => ({
                env: m.env || m.id || null,
                ownQty: num(m.ownQty),
                signal: m.signal || null,
            }))
            : [],
        recordedNet: num(row.recorded?.net ?? row.recordedNet),
    };
}

function ruleSuggestions(factors) {
    const items = [];
    if (!factors?.symbol) {
        return [{ title: "Chưa chọn vị thế", detail: "Chọn một dòng trong bảng Terminal rồi gọi /ai hoặc mở tab Journal." }];
    }
    if (!factors.protection?.hasSl) {
        items.push({ title: "Thiếu Stop Loss sàn", detail: "Vị thế chưa có SL exchange — rủi ro gap cao hơn khi mất kết nối monitor." });
    } else if (factors.slDistancePct != null && factors.slDistancePct < 0) {
        items.push({ title: "SL đã bị vượt", detail: "Mark đã qua mức SL — kiểm tra lệnh bảo vệ còn sống hay đã hủy." });
    } else if (factors.slDistancePct != null && factors.slDistancePct < 0.4) {
        items.push({ title: "SL rất sát mark", detail: `Còn ~${factors.slDistancePct.toFixed(2)}% biến động giá tới SL — dễ bị quét nhiễu.` });
    }
    if (!factors.protection?.hasTp) {
        items.push({ title: "Chưa có Take Profit", detail: "Không bắt buộc, nhưng thiếu TP dễ giữ lệnh quá lâu khi đã đạt mục tiêu." });
    }
    if (factors.liqDistancePct != null && factors.liqDistancePct < 2) {
        items.push({ title: "Gần thanh lý", detail: `Thanh lý chỉ còn ~${factors.liqDistancePct.toFixed(2)}% — giảm size hoặc thêm margin.` });
    }
    if (factors.leverage != null && factors.leverage >= 20) {
        items.push({ title: "Đòn bẩy cao", detail: `${factors.leverage}x — biến động nhỏ cũng làm ROI/margin nhảy mạnh.` });
    }
    if (factors.roiEst != null && factors.roiEst <= -15) {
        items.push({ title: "Lỗ margin lớn", detail: `ROI ước tính ~${factors.roiEst.toFixed(1)}% — xem lại plan thoát hoặc cắt một phần.` });
    } else if (factors.roiEst != null && factors.roiEst >= 20 && !factors.protection?.hasSl) {
        items.push({ title: "Đang lãi nhưng chưa khóa", detail: "Có lãi mà chưa SL — cân nhắc dời SL về entry (chi phí chưa tính)." });
    }
    if (factors.ownership === "over") {
        items.push({ title: "Own qty > sàn", detail: "Phân bổ monitor lệch — đừng đóng theo ownQty vượt positionAmt." });
    } else if (factors.ownership === "under" || factors.ownership === "unassigned") {
        items.push({ title: "Có leftover / chưa gán monitor", detail: "Một phần qty sàn không thuộc config đang xem — đóng là đóng cả vị thế sàn." });
    }
    if (factors.book === "paper") {
        items.push({ title: "Sổ paper", detail: "Không dùng lệnh đóng/mở sàn cho dòng paper." });
    }
    if (!items.length) {
        items.push({
            title: "Không có cảnh báo cứng",
            detail: factors.movePct != null
                ? `Giá dịch chuyển ~${factors.movePct.toFixed(2)}% theo hướng lệnh; uPnL ${factors.unrealized ?? "—"} USDT.`
                : "Đủ dữ liệu tối thiểu; theo dõi SL/TP và funding nếu giữ lâu.",
        });
    }
    return items.slice(0, 6);
}

const COACH_INSTRUCTIONS = [
    "Viết tiếng Việt, tối đa 5 gợi ý ngắn cho vị thế futures đang mở.",
    "Chỉ dùng số liệu trong JSON factors. Không bịa giá, ROI, SL, TP.",
    "Ưu tiên rủi ro: thiếu SL, gần thanh lý, đòn bẩy cao, lệch ownership, paper.",
    "Không khuyến khích tăng size khi đang lỗ nặng hoặc gần liq.",
    "Không nhắc API key, secret, password.",
    "Trả JSON {\"suggestions\":[{\"title\":\"...\",\"detail\":\"...\"}]} không thêm chữ ngoài JSON.",
].join(" ");

module.exports = {
    collectFactors,
    ruleSuggestions,
    COACH_INSTRUCTIONS,
};
