/**
 * Phân tích yếu tố vị thế mở + gợi ý rule-based (fallback khi chưa cấu hình AI).
 * Có thể gắn market (cấu trúc/ATR/vùng) từ market-structure.js.
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
        market: row.market || null,
    };
}

function suggestion(title, detail, extra = {}) {
    return {
        title,
        detail,
        kind: extra.kind || "risk",
        action: extra.action || null,
    };
}

function ruleSuggestions(factors) {
    const items = [];
    if (!factors?.symbol) {
        return [suggestion("Chưa chọn vị thế", "Chọn một dòng trong bảng Terminal rồi gọi /ai hoặc mở tab Journal.")];
    }
    if (!factors.protection?.hasSl) {
        items.push(suggestion("Thiếu Stop Loss sàn", "Vị thế chưa có SL exchange — rủi ro gap cao hơn khi mất kết nối monitor.", { kind: "risk" }));
    } else if (factors.slDistancePct != null && factors.slDistancePct < 0) {
        items.push(suggestion("SL đã bị vượt", "Mark đã qua mức SL — kiểm tra lệnh bảo vệ còn sống hay đã hủy.", { kind: "risk" }));
    } else if (factors.slDistancePct != null && factors.slDistancePct < 0.4) {
        items.push(suggestion("SL rất sát mark", `Còn ~${factors.slDistancePct.toFixed(2)}% biến động giá tới SL — dễ bị quét nhiễu.`, { kind: "risk" }));
    }
    if (!factors.protection?.hasTp) {
        items.push(suggestion("Chưa có Take Profit", "Không bắt buộc, nhưng thiếu TP dễ giữ lệnh quá lâu khi đã đạt mục tiêu.", { kind: "risk" }));
    }
    if (factors.liqDistancePct != null && factors.liqDistancePct < 2) {
        items.push(suggestion("Gần thanh lý", `Thanh lý chỉ còn ~${factors.liqDistancePct.toFixed(2)}% — giảm size hoặc thêm margin.`, { kind: "risk" }));
    }
    if (factors.leverage != null && factors.leverage >= 20) {
        items.push(suggestion("Đòn bẩy cao", `${factors.leverage}x — biến động nhỏ cũng làm ROI/margin nhảy mạnh.`, { kind: "risk" }));
    }
    if (factors.roiEst != null && factors.roiEst <= -15) {
        items.push(suggestion("Lỗ margin lớn", `ROI ước tính ~${factors.roiEst.toFixed(1)}% — xem lại plan thoát hoặc cắt một phần.`, { kind: "risk" }));
    } else if (factors.roiEst != null && factors.roiEst >= 20 && !factors.protection?.hasSl) {
        items.push(suggestion(
            "Đang lãi nhưng chưa khóa",
            "Có lãi mà chưa SL — cân nhắc dời SL về entry (chi phí chưa tính).",
            {
                kind: "level",
                action: factors.entry != null ? { type: "sl", price: factors.entry, label: "SL về entry" } : null,
            }
        ));
    }
    if (factors.ownership === "over") {
        items.push(suggestion("Own qty > sàn", "Phân bổ monitor lệch — đừng đóng theo ownQty vượt positionAmt.", { kind: "risk" }));
    } else if (factors.ownership === "under" || factors.ownership === "unassigned") {
        items.push(suggestion("Có leftover / chưa gán monitor", "Một phần qty sàn không thuộc config đang xem — đóng là đóng cả vị thế sàn.", { kind: "risk" }));
    }
    if (factors.book === "paper") {
        items.push(suggestion("Sổ paper", "Không dùng lệnh đóng/mở sàn cho dòng paper.", { kind: "risk" }));
    }
    return items;
}

function marketSuggestions(factors) {
    const market = factors?.market;
    if (!market || market.error) {
        if (market?.error) {
            return [suggestion("Thiếu dữ liệu nến", String(market.error), { kind: "market" })];
        }
        return [];
    }
    const items = [];
    const s15 = market.structure15?.label || "—";
    const s1h = market.structure1h?.label || "—";
    items.push(suggestion(
        "Cấu trúc thị trường",
        `15m: ${s15}. 1h: ${s1h}. EMA20/50: ${market.ema20 ?? "—"} / ${market.ema50 ?? "—"} · ATR14≈${market.atr14 ?? "—"} (${market.atrPct ?? "—"}%).`,
        { kind: "structure" }
    ));

    if (market.alignment === "against") {
        items.push(suggestion(
            "Lệnh ngược cấu trúc/EMA",
            "Side hiện tại đi ngược bias 15m hoặc xếp EMA — cân nhắc siết SL hoặc giảm size; không tự đảo lệnh.",
            { kind: "structure" }
        ));
    } else if (market.alignment === "with") {
        items.push(suggestion(
            "Lệnh cùng chiều cấu trúc",
            "Bias 15m/EMA đang ủng hộ side — vẫn cần SL theo vùng hỗ trợ/kháng cự hoặc ATR.",
            { kind: "structure" }
        ));
    }

    if (market.support != null || market.resistance != null) {
        items.push(suggestion(
            "Vùng hỗ trợ / kháng cự 15m",
            `Hỗ trợ ≈ ${market.support ?? "—"} · Kháng cự ≈ ${market.resistance ?? "—"}. Dùng làm điểm mua/bán tham chiếu, không phải lệnh tự động.`,
            { kind: "market" }
        ));
    }

    for (const level of market.levels || []) {
        if (level.role !== "sl" && level.role !== "tp") continue;
        const actionType = level.role === "sl" ? "sl" : "tp";
        items.push(suggestion(
            level.label,
            `${level.reason || ""} · giá ${level.price}`.trim(),
            {
                kind: "level",
                action: {
                    type: actionType,
                    price: level.price,
                    label: level.label,
                    levelId: level.id,
                },
            }
        ));
    }

    return items;
}

function buildSuggestions(factors) {
    const risk = ruleSuggestions(factors);
    const market = marketSuggestions(factors);
    const merged = [...risk, ...market];
    if (!merged.length) {
        return [suggestion(
            "Không có cảnh báo cứng",
            factors.movePct != null
                ? `Giá dịch chuyển ~${factors.movePct.toFixed(2)}% theo hướng lệnh; uPnL ${factors.unrealized ?? "—"} USDT.`
                : "Đủ dữ liệu tối thiểu; theo dõi SL/TP và funding nếu giữ lâu."
        )];
    }
    return merged.slice(0, 12);
}

const COACH_INSTRUCTIONS = [
    "Viết tiếng Việt, tối đa 8 gợi ý ngắn cho vị thế futures đang mở.",
    "Chỉ dùng số liệu trong JSON factors (gồm market: EMA/ATR/cấu trúc/levels). Không bịa giá.",
    "Ưu tiên: rủi ro vị thế, cấu trúc 15m/1h, vùng hỗ trợ-kháng cự, điểm mua/bán, vùng SL/TP có thể áp dụng.",
    "Với mức giá đề xuất, trả thêm action: {\"type\":\"sl\"|\"tp\",\"price\":number,\"label\":\"...\"} lấy đúng từ market.levels hoặc entry.",
    "Không khuyến khích tăng size khi đang lỗ nặng, gần liq, hoặc alignment=against.",
    "Không nhắc API key, secret, password.",
    "Trả JSON {\"suggestions\":[{\"title\":\"...\",\"detail\":\"...\",\"kind\":\"risk|structure|level|market\",\"action\":null|{\"type\":\"sl|tp\",\"price\":123,\"label\":\"...\"}}]} không thêm chữ ngoài JSON.",
].join(" ");

module.exports = {
    collectFactors,
    ruleSuggestions,
    marketSuggestions,
    buildSuggestions,
    COACH_INSTRUCTIONS,
};
