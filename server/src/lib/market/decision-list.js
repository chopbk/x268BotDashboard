/**
 * Location P1a — derive decision fields cho danh sách.
 * Spec: docs/market-decision-list-spec.md
 */
const DECISION_VERSION = "market-decision-v1";
const CHANGED_WINDOW_MS = 2 * 60 * 60 * 1000;
const OI_DEAD_BAND = 0.15;

const ACTION_RANK = Object.freeze({
    in_zone: 0,
    wait_confirm: 1,
    watch: 2,
    skip: 3,
});

const ACTION_LABEL = Object.freeze({
    in_zone: "Trong vùng",
    wait_confirm: "Chờ xác nhận",
    watch: "Theo dõi",
    skip: "Bỏ qua",
});

const OI_LABEL = Object.freeze({
    new_long: "Long mới",
    covering: "Covering",
    new_short: "Short mới",
    flush: "Flush",
});

const CONFLICT_LABEL_BY_ID = Object.freeze({
    htf_conflict: "HTF ngược",
    setup_htf: "HTF ngược",
    htf_vs_structure: "HTF ngược",
    flow_vs_setup: "Flow ngược",
    score_conflict: "Điểm conflict",
    composite_conflict: "Điểm conflict",
    near_resistance: "KC gần",
    near_support: "HT gần",
    price_stale: "Giá cũ",
    price_not_fresh: "Giá cũ",
    data_stale: "Data cũ",
    frame_quality: "Data cũ",
    flow_stale: "Flow cũ",
    zone_conflict: "Kẹp S/R",
    sr_squeeze: "Kẹp S/R",
});

const CONFLICT_PRIORITY = [
    "HTF ngược",
    "Flow ngược",
    "Giá cũ",
    "Data cũ",
    "Flow cũ",
    "Điểm conflict",
    "KC gần",
    "HT gần",
    "Kẹp S/R",
];

function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function round(n, digits = 2) {
    const v = num(n);
    if (v == null) return null;
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}

function oppositeStructure(side, htfBias) {
    if (!htfBias || htfBias === "n/a" || htfBias === "unknown" || htfBias === "warming") return false;
    if (side === "long" && htfBias === "bearish") return true;
    if (side === "short" && htfBias === "bullish") return true;
    return false;
}

function nearZone(loc) {
    const tags = loc?.positionTags || [];
    return (
        tags.includes("near_support") ||
        tags.includes("in_support") ||
        tags.includes("near_resistance") ||
        tags.includes("in_resistance")
    );
}

/**
 * RR tại entry bất lợi trong band; target = biên gần vùng đối diện.
 */
function computeRr({ side, entryLow, entryHigh, invalidationLevel, support, resistance } = {}) {
    const S = num(invalidationLevel);
    const low = num(entryLow);
    const high = num(entryHigh);
    if (S == null || low == null || high == null) {
        return { rr: null, entryUsed: null, targetLevel: null, targetRole: null };
    }
    let E = null;
    let T = null;
    let targetRole = null;
    if (side === "long") {
        E = high;
        T = num(resistance?.low);
        targetRole = T != null ? "resistance" : null;
        if (T == null || !(S < E && E < T)) {
            return { rr: null, entryUsed: E, targetLevel: T, targetRole };
        }
    } else if (side === "short") {
        E = low;
        T = num(support?.high);
        targetRole = T != null ? "support" : null;
        if (T == null || !(T < E && E < S)) {
            return { rr: null, entryUsed: E, targetLevel: T, targetRole };
        }
    } else {
        return { rr: null, entryUsed: null, targetLevel: null, targetRole: null };
    }
    const risk = Math.abs(E - S);
    if (risk === 0) return { rr: null, entryUsed: E, targetLevel: T, targetRole };
    return {
        rr: round(Math.abs(T - E) / risk, 2),
        entryUsed: E,
        targetLevel: T,
        targetRole,
    };
}

function deriveAction({ loc, setup } = {}) {
    const priceFresh = loc?.priceFresh !== false;
    const quality = loc?.quality;
    const active = setup && setup.lifecycle === "active";

    if (!priceFresh) {
        return { action: "skip", actionReason: "Giá không fresh — không dùng làm quyết định vào lệnh" };
    }
    if (active && oppositeStructure(setup.side, loc?.htfBias)) {
        return { action: "skip", actionReason: `Setup ${setup.side} ngược HTF ${loc.htfBias}` };
    }
    if (
        !active &&
        (quality === "stale" || quality === "error" || quality === "missing") &&
        !nearZone(loc)
    ) {
        return { action: "skip", actionReason: `Chất lượng location: ${quality || "missing"}` };
    }
    if (!active && !nearZone(loc)) {
        return { action: "skip", actionReason: "Không có setup active và không gần vùng S/R" };
    }
    if (
        active &&
        setup.entryState === "in_entry" &&
        (quality === "ready" || quality === "partial" || quality == null)
    ) {
        return { action: "in_zone", actionReason: "Giá trong entry band — chưa phải fill lệnh" };
    }
    if (active && (setup.entryState === "awaiting_entry" || setup.entryState === "in_entry")) {
        return {
            action: "wait_confirm",
            actionReason:
                setup.entryState === "awaiting_entry"
                    ? "Setup active — chờ giá vào / xác nhận entry"
                    : "Chờ điều kiện xác nhận đủ (quality/touch)",
        };
    }
    if (active || nearZone(loc)) {
        return { action: "watch", actionReason: active ? "Setup active ngoài vùng ưu tiên" : "Gần vùng S/R — theo dõi" };
    }
    return { action: "skip", actionReason: "Không đủ điều kiện xem" };
}

function conflictsShortFromObstacles(obstacles = [], conflicts = []) {
    const labels = [];
    const seen = new Set();
    const push = (id) => {
        const label = CONFLICT_LABEL_BY_ID[id];
        if (!label || seen.has(label)) return;
        seen.add(label);
        labels.push(label);
    };
    for (const o of obstacles || []) push(o?.id);
    for (const c of conflicts || []) push(c?.id);
    labels.sort((a, b) => {
        const ia = CONFLICT_PRIORITY.indexOf(a);
        const ib = CONFLICT_PRIORITY.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return labels.slice(0, 3);
}

function deriveOiRegime({ priceChangePct, oiDeltaPct, flowStale, hasFlow } = {}) {
    if (!hasFlow) {
        return { oiRegime: null, oiRegimeLabel: null, oiRegimeReason: "flow_unavailable" };
    }
    if (flowStale) {
        return { oiRegime: null, oiRegimeLabel: null, oiRegimeReason: "flow_stale" };
    }
    const p = num(priceChangePct);
    const o = num(oiDeltaPct);
    if (p == null || o == null) {
        return { oiRegime: null, oiRegimeLabel: null, oiRegimeReason: "missing_price_or_oi" };
    }
    const priceUp = p > OI_DEAD_BAND;
    const priceDown = p < -OI_DEAD_BAND;
    const oiUp = o > OI_DEAD_BAND;
    const oiDown = o < -OI_DEAD_BAND;
    if (!priceUp && !priceDown) {
        return { oiRegime: null, oiRegimeLabel: null, oiRegimeReason: "price_flat" };
    }
    if (!oiUp && !oiDown) {
        return { oiRegime: null, oiRegimeLabel: null, oiRegimeReason: "oi_flat" };
    }
    let oiRegime = null;
    if (priceUp && oiUp) oiRegime = "new_long";
    else if (priceUp && oiDown) oiRegime = "covering";
    else if (priceDown && oiUp) oiRegime = "new_short";
    else if (priceDown && oiDown) oiRegime = "flush";
    return {
        oiRegime,
        oiRegimeLabel: oiRegime ? OI_LABEL[oiRegime] : null,
        oiRegimeReason: null,
    };
}

function formatAgeLabel(ageMs) {
    if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return null;
    const mins = Math.round(ageMs / 60_000);
    if (mins < 60) return `Mới ${Math.max(0, mins)}p`;
    const hours = Math.round(mins / 60);
    return `Mới ${hours}h`;
}

function deriveChanged({ setup, recentEvents, now = Date.now() } = {}) {
    const empty = { kind: null, label: null, at: null, ageMs: null };
    const within = (iso) => {
        if (!iso) return null;
        const t = new Date(iso).getTime();
        if (!Number.isFinite(t)) return null;
        const ageMs = now - t;
        if (ageMs < 0 || ageMs > CHANGED_WINDOW_MS) return null;
        return { at: new Date(t).toISOString(), ageMs };
    };

    if (setup?.lifecycle === "active") {
        const created = within(setup.createdAt);
        if (created) {
            return {
                kind: "setup_new",
                label: formatAgeLabel(created.ageMs),
                at: created.at,
                ageMs: created.ageMs,
            };
        }
    }

    for (const ev of recentEvents || []) {
        if (ev?.type !== "retest") continue;
        const hit = within(ev.at || ev.time || ev.asOf || ev.confirmedAt);
        if (hit) {
            return { kind: "retest", label: formatAgeLabel(hit.ageMs), at: hit.at, ageMs: hit.ageMs };
        }
    }

    if (setup?.lifecycle === "active") {
        const touched = within(setup.firstTouchedAt);
        if (touched) {
            return {
                kind: "in_entry",
                label: formatAgeLabel(touched.ageMs),
                at: touched.at,
                ageMs: touched.ageMs,
            };
        }
    }
    return empty;
}

function relativeVsBtc24h(coinChangePct, btcChangePct) {
    const c = num(coinChangePct);
    const b = num(btcChangePct);
    if (c == null || b == null) return null;
    return round(c - b, 2);
}

/**
 * @returns decision object gắn vào context.decision
 */
function buildDecision({
    loc,
    setup,
    obstacles,
    conflicts,
    flow,
    priceChangePct,
    btcChangePct24h,
    canFlowLink = false,
    now = Date.now(),
} = {}) {
    const primary = setup || loc?.primarySetup || null;
    const { action, actionReason } = deriveAction({ loc, setup: primary });
    const rrParts = computeRr({
        side: primary?.side,
        entryLow: primary?.entryLow,
        entryHigh: primary?.entryHigh,
        invalidationLevel: primary?.invalidationLevel,
        support: loc?.support,
        resistance: loc?.resistance,
    });
    const conflictsShort = conflictsShortFromObstacles(obstacles, conflicts);
    const oiDeltaPct = num(flow?.openInterest?.deltaPct);
    const oi = deriveOiRegime({
        priceChangePct,
        oiDeltaPct,
        flowStale: Boolean(flow?.stale),
        hasFlow: Boolean(flow),
    });
    const changed = deriveChanged({ setup: primary, recentEvents: loc?.recentEvents, now });
    const rel = relativeVsBtc24h(priceChangePct, btcChangePct24h);

    return {
        version: DECISION_VERSION,
        action,
        actionLabel: ACTION_LABEL[action] || action,
        actionReason: actionReason || null,
        side: primary?.side || null,
        setupType: primary?.type || null,
        entryState: primary?.entryState || null,
        entryLow: primary?.entryLow ?? null,
        entryHigh: primary?.entryHigh ?? null,
        invalidationLevel: primary?.invalidationLevel ?? null,
        targetLevel: rrParts.targetLevel,
        targetRole: rrParts.targetRole,
        rr: rrParts.rr,
        rrNote: "chưa gồm phí/slippage/funding; RR tại entry bất lợi trong band",
        conflictsShort,
        oiRegime: oi.oiRegime,
        oiRegimeLabel: oi.oiRegimeLabel,
        oiRegimeReason: oi.oiRegimeReason,
        priceChangePct: num(priceChangePct),
        oiDeltaPct,
        changed,
        relativeVsBtc24h: rel,
        links: { terminal: true, flow: Boolean(canFlowLink) },
    };
}

function actionRank(action) {
    return ACTION_RANK[action] ?? 9;
}

module.exports = {
    DECISION_VERSION,
    CHANGED_WINDOW_MS,
    ACTION_RANK,
    ACTION_LABEL,
    OI_LABEL,
    computeRr,
    deriveAction,
    deriveOiRegime,
    deriveChanged,
    conflictsShortFromObstacles,
    relativeVsBtc24h,
    buildDecision,
    actionRank,
    oppositeStructure,
    nearZone,
};
