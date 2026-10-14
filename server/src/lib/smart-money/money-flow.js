/**
 * Khối Dòng tiền cho Terminal — đọc snapshot chung, không collector riêng.
 */
const { getLatestSnapshot } = require("./store");
const { listEvents } = require("./detector");
const { fundingCostEstimate, finite } = require("./formulas");

async function buildMoneyFlow(symbol, positionContext = null) {
    const snap = await getLatestSnapshot(symbol);
    if (!snap) {
        return {
            available: false,
            reason: "warming",
            summary: "Chưa có snapshot Smart Money/thị trường cho symbol này.",
            metrics: [],
            alerts: [],
            smartMoneyPath: `/smart-money?symbol=${encodeURIComponent(String(symbol).toUpperCase())}`,
        };
    }

    const bias = snap.derived?.bias || "unclear";
    const whaleBias = snap.derived?.whaleBias || "unclear";
    const biasLabel =
        bias === "long" ? "Long" : bias === "short" ? "Short" : bias === "both" ? "Hai chiều" : "Chưa rõ";

    const metrics = [
        {
            key: "bias",
            label: "Nhóm trader",
            value: biasLabel,
            detail: snap.smartMoney?.status === "ok" ? "theo quantity" : "thiếu Smart Money",
        },
        {
            key: "whale_entry_long",
            label: "Giá ↔ whale Long entry",
            value: snap.derived?.distanceToWhaleEntryPct?.long,
            unit: "%",
        },
        {
            key: "whale_entry_short",
            label: "Giá ↔ whale Short entry",
            value: snap.derived?.distanceToWhaleEntryPct?.short,
            unit: "%",
        },
        {
            key: "oi_delta",
            label: "OI Δ",
            value: snap.openInterest?.deltaPct,
            unit: "%",
            detail: snap.openInterest?.status,
        },
        {
            key: "taker",
            label: "Taker B/S",
            value: snap.taker?.buySellRatio,
            detail: snap.taker?.status,
        },
        {
            key: "funding",
            label: "Funding",
            value: snap.funding?.currentRate != null ? snap.funding.currentRate * 100 : null,
            unit: "%/kỳ",
            detail: snap.funding?.intervalHours != null ? `${snap.funding.intervalHours}h` : "interval?",
        },
    ];

    const alerts = [];
    if (snap.quality?.stale) alerts.push({ level: "warn", text: "Dữ liệu thị trường đang stale — giữ bản tốt gần nhất." });
    if (snap.derived?.deltas?.cohortReset) alerts.push({ level: "warn", text: "Cohort Smart Money đã đổi — không so delta qua mốc này." });
    if (snap.smartMoney?.status !== "ok") {
        alerts.push({ level: "info", text: "Thiếu Smart Money — vẫn hiện OI/funding/taker nếu còn hợp lệ." });
    }
    if (whaleBias !== "unclear" && bias !== "unclear" && whaleBias !== bias && bias !== "both") {
        alerts.push({ level: "warn", text: "Whale và nhóm trader đang mâu thuẫn." });
    }

    let fundingNote = null;
    if (positionContext?.side && positionContext?.notional != null) {
        const est = fundingCostEstimate(
            snap.funding?.currentRate,
            positionContext.notional,
            snap.funding?.intervalHours,
            positionContext.side
        );
        if (est) {
            fundingNote = est;
            const benefit =
                est.signedForSide == null
                    ? null
                    : est.signedForSide > 0
                      ? "chi phí"
                      : "lợi ích";
            if (benefit) {
                alerts.push({
                    level: "info",
                    text: `Funding ước tính ~${Math.abs(est.signedForSide).toFixed(2)} USDT/kỳ (${benefit}). ${est.assumption}`,
                });
            }
        }
    }

    let takerAlign = null;
    if (positionContext?.side && finite(snap.taker?.buySellRatio) != null) {
        const t = snap.taker.buySellRatio;
        const side = String(positionContext.side).toUpperCase();
        if (side === "LONG") takerAlign = t >= 1 ? "đồng thuận" : "ngược";
        if (side === "SHORT") takerAlign = t <= 1 ? "đồng thuận" : "ngược";
    }

    const recentEvents = await listEvents({ symbol: snap.symbol, limit: 5 });

    const summaryParts = [
        `Nhóm trader: ${biasLabel}.`,
        snap.openInterest?.deltaPct != null
            ? `OI Δ ${snap.openInterest.deltaPct >= 0 ? "+" : ""}${snap.openInterest.deltaPct.toFixed(1)}%.`
            : "OI chưa có.",
        takerAlign ? `Taker ${takerAlign} với side vị thế.` : null,
        `Độ mới: ${snap.quality?.overall || "?"}.`,
    ].filter(Boolean);

    return {
        available: true,
        reason: null,
        summary: summaryParts.join(" "),
        collectedAt: snap.collectedAt,
        quality: snap.quality,
        bias,
        whaleBias,
        metrics: metrics.filter((m) => m.value != null || m.key === "bias"),
        alerts,
        fundingNote,
        takerAlign,
        events: recentEvents.map((e) => ({
            type: e.type,
            direction: e.direction,
            at: e.at,
            message: e.message,
            smallSample: e.smallSample,
        })),
        smartMoneyPath: `/smart-money?tab=market&symbol=${encodeURIComponent(snap.symbol)}`,
        schemaVersion: snap.schemaVersion,
    };
}

/** Ngữ cảnh AI — chỉ số đã tính, không vị thế người khác. */
function toMarketContext(snapshot, extras = {}) {
    if (!snapshot) {
        return {
            available: false,
            missing: ["smart_money_snapshot"],
            note: "Chưa có snapshot Smart Money.",
        };
    }
    return {
        available: true,
        schemaVersion: snapshot.schemaVersion,
        symbol: snapshot.symbol,
        collectedAt: snapshot.collectedAt,
        quality: snapshot.quality,
        cohortId: snapshot.smartMoney?.cohortId || null,
        signalDay: snapshot.smartMoney?.signalDay || null,
        comparable: snapshot.smartMoney?.comparable ?? null,
        bias: snapshot.derived?.bias,
        whaleBias: snapshot.derived?.whaleBias,
        deltas: snapshot.derived?.deltas || {},
        distanceToWhaleEntryPct: snapshot.derived?.distanceToWhaleEntryPct || {},
        openInterest: {
            qty: snapshot.openInterest?.qty ?? null,
            notional: snapshot.openInterest?.notional ?? null,
            deltaPct: snapshot.openInterest?.deltaPct ?? null,
            status: snapshot.openInterest?.status,
        },
        funding: {
            currentRate: snapshot.funding?.currentRate ?? null,
            intervalHours: snapshot.funding?.intervalHours ?? null,
            status: snapshot.funding?.status,
        },
        taker: {
            buySellRatio: snapshot.taker?.buySellRatio ?? null,
            status: snapshot.taker?.status,
        },
        smartMoneyStatus: snapshot.smartMoney?.status,
        events: extras.events || [],
        candidates: extras.candidates || [],
        note: "Chỉ diễn giải số liệu đã tính. Không khẳng định cùng một whale. Thiếu field = null.",
    };
}

module.exports = { buildMoneyFlow, toMarketContext };
