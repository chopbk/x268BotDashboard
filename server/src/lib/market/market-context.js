/**
 * Market intelligence P0 — derive overview/row/decision context từ snapshot cache.
 * Không gọi sàn; không đổi market-v1 / setup lifecycle.
 */
const { INTERVAL_MS, FORMULA_VERSION } = require("./config");
const { STRUCTURE_LABEL } = require("./location");
const { SETUP_EXPIRY_BARS, SETUP_VERSION } = require("./setup-engine");
const { buildDecision, DECISION_VERSION } = require("./decision-list");
const CONTEXT_VERSION = "market-context-v1";
const BTC_CONTEXT_TF = "4h";

function envelope(partial = {}) {
    return {
        value: partial.value ?? null,
        unit: partial.unit ?? null,
        source: partial.source ?? "market-cache",
        venue: partial.venue ?? "binance-usdm",
        window: partial.window ?? null,
        asOf: partial.asOf ?? null,
        collectedAt: partial.collectedAt ?? null,
        quality: partial.quality ?? "missing",
        reason: partial.reason ?? null,
        version: partial.version || CONTEXT_VERSION,
    };
}

/** Map domain quality → envelope (không ghi đè enum DB). ready → fresh cho field mới. */
function mapDomainQuality(overall, extras = {}) {
    if (overall == null || overall === "") {
        return { quality: "missing", reason: extras.reason || "không có quality" };
    }
    if (overall === "ready" || overall === "ok") {
        return { quality: "fresh", reason: null };
    }
    if (overall === "warming" || overall === "pending") {
        return { quality: overall === "pending" ? "warming" : "warming", reason: extras.reason || overall };
    }
    if (overall === "stale") {
        return { quality: "stale", reason: extras.reason || "dữ liệu cũ" };
    }
    if (overall === "partial" || overall === "degraded") {
        return { quality: "stale", reason: extras.reason || overall };
    }
    if (overall === "error" || overall === "source_error" || overall === "missing") {
        return { quality: overall === "missing" ? "missing" : "error", reason: extras.reason || overall };
    }
    return { quality: "missing", reason: String(overall) };
}

function round(n, digits = 2) {
    if (n == null || !Number.isFinite(Number(n))) return null;
    const f = 10 ** digits;
    return Math.round(Number(n) * f) / f;
}

function atrPctFromFrame(frame) {
    if (!frame) return null;
    const atr = frame.indicators?.atr14;
    const close = frame.indicators?.lastClose ?? frame.lastClose;
    if (atr == null || close == null || !Number.isFinite(Number(atr)) || !Number.isFinite(Number(close))) {
        return null;
    }
    if (Number(close) === 0) return null;
    return round((Number(atr) / Number(close)) * 100, 3);
}

function estimateExpiresAt(setup, timeframe, candleCloseTime) {
    if (!setup || setup.expiresAtIndex == null) return null;
    if (setup.createdAt && setup.createdIndex != null && Number.isFinite(Number(setup.createdIndex))) {
        const barMs = INTERVAL_MS[timeframe];
        if (barMs && setup.expiresAtIndex >= setup.createdIndex) {
            const createdMs = new Date(setup.createdAt).getTime();
            if (Number.isFinite(createdMs)) {
                const bars = setup.expiresAtIndex - setup.createdIndex;
                return new Date(createdMs + bars * barMs).toISOString();
            }
        }
    }
    if (candleCloseTime && setup.expiresAtIndex != null) {
        return null;
    }
    return null;
}

function barsRemaining(setup, candleIndexHint) {
    if (setup?.expiresAtIndex == null) return null;
    if (candleIndexHint == null || !Number.isFinite(Number(candleIndexHint))) return null;
    return Math.max(0, setup.expiresAtIndex - Number(candleIndexHint));
}

function oppositeStructure(side, htfBias) {
    if (!htfBias || htfBias === "n/a" || htfBias === "unknown" || htfBias === "warming") return false;
    if (side === "long" && htfBias === "bearish") return true;
    if (side === "short" && htfBias === "bullish") return true;
    return false;
}

function structureHtfConflict(structureBias, htfBias) {
    if (!structureBias || structureBias === "unknown") return false;
    if (!htfBias || htfBias === "n/a" || htfBias === "unknown" || htfBias === "warming") return false;
    if (structureBias === "bullish" && htfBias === "bearish") return true;
    if (structureBias === "bearish" && htfBias === "bullish") return true;
    return false;
}

function buildBtc4hCard(btcSnap) {
    const frame = btcSnap?.timeframes?.[BTC_CONTEXT_TF];
    if (!btcSnap || !frame) {
        return envelope({
            value: null,
            unit: null,
            window: BTC_CONTEXT_TF,
            quality: "missing",
            reason: btcSnap ? "thiếu khung 4h BTC" : "thiếu snapshot BTCUSDT",
            source: "market-score-latest",
        });
    }
    const q = mapDomainQuality(frame.quality?.overall || btcSnap.qualityOverall);
    const value = {
        symbol: "BTCUSDT",
        timeframe: BTC_CONTEXT_TF,
        regime: frame.regime || null,
        structureBias: frame.structureBias || null,
        structureLabel: STRUCTURE_LABEL[frame.structureBias] || frame.structureBias || null,
        bias: frame.bias || null,
        longScore: frame.longScore ?? null,
        shortScore: frame.shortScore ?? null,
    };
    return envelope({
        value,
        unit: "regime",
        window: BTC_CONTEXT_TF,
        asOf: frame.candleCloseTime || btcSnap.calculatedAt || null,
        collectedAt: btcSnap.calculatedAt || null,
        quality: q.quality,
        reason: q.reason,
        source: "market-score-latest",
    });
}

function buildBreadthCard(breadth, coverage) {
    const universeTotal = coverage?.total ?? null;
    const scored = coverage?.scored ?? null;
    const missing =
        universeTotal != null && scored != null ? Math.max(0, universeTotal - scored) : null;
    if (breadth == null || universeTotal == null) {
        return envelope({
            value: null,
            quality: "missing",
            reason: "thiếu breadth hoặc universe",
            window: "1h",
        });
    }
    const leanLong = breadth.leanLong ?? 0;
    const leanShort = breadth.leanShort ?? 0;
    const eligible = breadth.eligible ?? 0;
    const conflict = breadth.conflict ?? 0;
    // Không đổi mẫu số: luôn dùng universeTotal, không chia cho scored.
    let quality = "fresh";
    let reason = null;
    if (scored === 0) {
        quality = "warming";
        reason = "chưa có symbol đã chấm";
    } else if (missing > 0) {
        quality = "stale";
        reason = `${missing} symbol chưa chấm — mẫu số vẫn là ${universeTotal}`;
    }
    return envelope({
        value: {
            leanLong,
            leanShort,
            eligible,
            conflict,
            trending: breadth.trending ?? null,
            ranging: breadth.ranging ?? null,
            transitional: breadth.transitional ?? null,
            universeTotal,
            scored,
            missing,
            timeframe: "1h",
            label:
                missing != null
                    ? `${leanLong}/${universeTotal} nghiêng Long; ${leanShort}/${universeTotal} nghiêng Short; ${missing}/${universeTotal} thiếu dữ liệu chấm`
                    : null,
        },
        unit: "count",
        window: "1h",
        quality,
        reason,
        source: "market-composites",
    });
}

function buildVolatilityCard(btcSnap) {
    const frame = btcSnap?.timeframes?.[BTC_CONTEXT_TF];
    const atrPct = atrPctFromFrame(frame);
    if (atrPct == null) {
        return envelope({
            value: null,
            unit: "percent",
            window: BTC_CONTEXT_TF,
            quality: "missing",
            reason: "thiếu ATR14 hoặc close BTC 4h",
            source: "market-score-latest",
        });
    }
    const q = mapDomainQuality(frame.quality?.overall || btcSnap.qualityOverall);
    return envelope({
        value: { atrPct, atr14: frame.indicators?.atr14 ?? null, close: frame.indicators?.lastClose ?? null },
        unit: "percent",
        window: BTC_CONTEXT_TF,
        asOf: frame.candleCloseTime || btcSnap.calculatedAt || null,
        quality: q.quality,
        reason: q.reason,
        source: "market-score-latest",
        // P0: không gắn nhãn cực đoan / percentile
    });
}

function countSetupsOnSnaps(snaps, analysisTf) {
    let active = 0;
    let inEntry = 0;
    let withLocation = 0;
    for (const snap of snaps || []) {
        const loc = snap?.locationByTimeframe?.[analysisTf];
        if (!loc) continue;
        withLocation += 1;
        for (const s of loc.setups || []) {
            if (s.lifecycle !== "active") continue;
            active += 1;
            if (s.entryState === "in_entry") inEntry += 1;
        }
    }
    return { active, inEntry, withLocation };
}

function buildSetupCountsCard(snaps, analysisTf, universeCount) {
    const counts = countSetupsOnSnaps(snaps, analysisTf);
    if (!snaps?.length) {
        return envelope({
            value: null,
            quality: "missing",
            reason: "chưa có snapshot",
            window: analysisTf,
        });
    }
    const quality = counts.withLocation === 0 ? "warming" : "fresh";
    return envelope({
        value: {
            active: counts.active,
            inEntry: counts.inEntry,
            analysisTf,
            universeCount: universeCount ?? snaps.length,
            withLocation: counts.withLocation,
            scope: `toàn universe được phép, khung ${analysisTf}, trước filter Top`,
            note: "in_entry = giá trong vùng entry — chưa phải lệnh đã khớp",
        },
        unit: "count",
        window: analysisTf,
        quality,
        reason: counts.withLocation === 0 ? "chưa có location trên universe" : null,
        source: "locationByTimeframe",
    });
}

function buildBriefStatements(cards) {
    const statements = [];
    const btc = cards.btc4h?.value;
    if (btc && cards.btc4h.quality !== "missing" && cards.btc4h.quality !== "error") {
        const struct = btc.structureLabel || btc.structureBias || "chưa rõ";
        const regime = btc.regime ? `, regime ${btc.regime}` : "";
        statements.push({
            id: "btc4h",
            text: `BTC 4h: cấu trúc ${struct}${regime}.`,
            refs: ["context.btc4h"],
        });
    }
    const br = cards.breadth?.value;
    if (br && cards.breadth.quality !== "missing") {
        const lean =
            br.leanLong > br.leanShort
                ? "nghiêng Long"
                : br.leanShort > br.leanLong
                  ? "nghiêng Short"
                  : "chưa đồng thuận hướng";
        const miss =
            br.missing > 0 ? ` (${br.missing}/${br.universeTotal} thiếu dữ liệu chấm)` : "";
        statements.push({
            id: "breadth",
            text: `Độ rộng 1h ${lean}: Long ${br.leanLong}/${br.universeTotal}, Short ${br.leanShort}/${br.universeTotal}${miss}.`,
            refs: ["context.breadth"],
        });
    }
    const sc = cards.setupCounts?.value;
    if (sc && cards.setupCounts.quality !== "missing" && cards.setupCounts.quality !== "warming") {
        statements.push({
            id: "setups",
            text: `Có ${sc.active} setup còn hiệu lực trên ${sc.analysisTf} (universe), trong đó ${sc.inEntry} đang trong vùng entry.`,
            refs: ["context.setupCounts"],
        });
    }
    const vol = cards.volatility?.value;
    if (vol?.atrPct != null && cards.volatility.quality !== "missing") {
        statements.push({
            id: "volatility",
            text: `ATR% BTC 4h ≈ ${vol.atrPct}% (không gắn nhãn cực đoan — thiếu baseline percentile).`,
            refs: ["context.volatility"],
        });
    }
    return statements.slice(0, 4);
}

/**
 * @param {{ snaps, universe, analysisTf, breadth, coverage, collector, asOf }} opts
 */
function buildOverviewContext(opts = {}) {
    const analysisTf = opts.analysisTf || "1h";
    const snaps = opts.snaps || [];
    const btcSnap = snaps.find((s) => s.symbol === "BTCUSDT") || opts.btcSnap || null;
    const coverage = opts.coverage || {};
    const breadth = opts.breadth || {};
    const universeCount = opts.universe?.count ?? coverage.total ?? snaps.length;

    const btc4h = buildBtc4hCard(btcSnap);
    const breadthCard = buildBreadthCard(breadth, coverage);
    const volatility = buildVolatilityCard(btcSnap);
    const setupCounts = buildSetupCountsCard(snaps, analysisTf, universeCount);

    const cards = { btc4h, breadth: breadthCard, volatility, setupCounts };
    const brief = buildBriefStatements(cards);

    let headerQuality = "fresh";
    const qualities = [btc4h.quality, breadthCard.quality, setupCounts.quality];
    if (qualities.includes("error")) headerQuality = "error";
    else if (qualities.includes("missing") || qualities.includes("warming")) headerQuality = "warming";
    else if (qualities.includes("stale")) headerQuality = "stale";

    const asOf =
        opts.asOf ||
        btc4h.asOf ||
        snaps.reduce((max, s) => {
            const t = s.calculatedAt || s.price?.asOf;
            if (!t) return max;
            if (!max || new Date(t) > new Date(max)) return t;
            return max;
        }, null);

    return {
        version: CONTEXT_VERSION,
        formulaVersion: FORMULA_VERSION,
        analysisTf,
        universeId: opts.universe?.version ?? null,
        asOf,
        quality: headerQuality,
        source: {
            venue: "binance-usdm",
            layer: "market-score-latest",
            note: "Đọc cache collector — không gọi sàn theo request",
        },
        btc4h,
        breadth: breadthCard,
        volatility,
        setupCounts,
        brief: {
            statements: brief,
            note: "Template code — mỗi mệnh đề gắn dữ liệu; thiếu input thì bỏ mệnh đề.",
        },
    };
}

function waitingCopy(setup) {
    if (!setup || setup.lifecycle !== "active") {
        return { text: null, reason: "không có setup active" };
    }
    if (setup.entryState === "in_entry") {
        return {
            text: "Giá trong vùng entry — chờ xác nhận hành động (không phải lệnh đã khớp)",
            reason: null,
            entryState: setup.entryState,
            touchEvidence: setup.touchEvidence || null,
        };
    }
    if (setup.entryState === "awaiting_entry") {
        const reasonBits = (setup.reasons || []).slice(0, 2).join("; ");
        return {
            text: reasonBits
                ? `Chờ chạm vùng entry (${reasonBits})`
                : "Chờ giá chạm vùng entry",
            reason: null,
            entryState: setup.entryState,
            touchEvidence: setup.touchEvidence || null,
        };
    }
    return {
        text: setup.entryState || "—",
        reason: null,
        entryState: setup.entryState,
        touchEvidence: setup.touchEvidence || null,
    };
}

function buildObstacles(loc, composite, flow, qualityOverall) {
    const obstacles = [];
    const setup = loc?.primarySetup;
    if (structureHtfConflict(loc?.structureBias, loc?.htfBias)) {
        obstacles.push({
            id: "htf_conflict",
            text: `Khung lớn ${loc.htfLabel || loc.htfBias} ngược cấu trúc ${loc.structureLabel || loc.structureBias}`,
            asOf: loc?.calculatedAt || null,
        });
    }
    if (setup && oppositeStructure(setup.side, loc?.htfBias)) {
        obstacles.push({
            id: "setup_htf",
            text: `Setup ${setup.side} đối mặt HTF ${loc.htfBias}`,
            asOf: setup.createdAt || loc?.calculatedAt || null,
        });
    }
    if (composite?.conflict) {
        obstacles.push({
            id: "score_conflict",
            text: "Composite Long/Short mâu thuẫn",
            asOf: null,
        });
    }
    if (setup?.side === "long" && loc?.resistance?.nearFar === "near") {
        obstacles.push({
            id: "near_resistance",
            text: `Kháng cự gần (${loc.resistance.distancePct != null ? `${round(loc.resistance.distancePct)}%` : "—"})`,
            asOf: loc?.priceAsOf || null,
        });
    }
    if (setup?.side === "short" && loc?.support?.nearFar === "near") {
        obstacles.push({
            id: "near_support",
            text: `Hỗ trợ gần (${loc.support.distancePct != null ? `${round(loc.support.distancePct)}%` : "—"})`,
            asOf: loc?.priceAsOf || null,
        });
    }
    if (loc?.priceFresh === false) {
        obstacles.push({
            id: "price_stale",
            text: "Giá không fresh",
            asOf: loc?.priceAsOf || null,
        });
    }
    if (qualityOverall === "stale" || loc?.quality === "partial" || loc?.quality === "stale") {
        obstacles.push({
            id: "data_stale",
            text: "Dữ liệu location/score cũ hoặc partial",
            asOf: loc?.calculatedAt || null,
        });
    }
    if (flow?.stale) {
        obstacles.push({
            id: "flow_stale",
            text: "Flow Smart Money stale — không dùng làm đồng thuận",
            asOf: flow.collectedAt || null,
        });
    }
    if (loc?.positionTags?.includes("conflict")) {
        obstacles.push({
            id: "zone_conflict",
            text: "Giá kẹp giữa hỗ trợ và kháng cự",
            asOf: loc?.priceAsOf || null,
        });
    }
    return obstacles.slice(0, 4);
}

/**
 * Tóm tắt context cho một dòng location.
 * `btcChangePct24h` / `priceChangePct` / `canFlowLink` phục vụ decision P1a (additive).
 */
function buildRowContext({
    loc,
    snap,
    flow,
    composite,
    priceChangePct,
    btcChangePct24h,
    canFlowLink = false,
    now = Date.now(),
} = {}) {
    const setup = loc?.primarySetup || null;
    const waiting = waitingCopy(setup);
    const obstacles = buildObstacles(loc, composite || snap?.composites?.intraday, flow, snap?.qualityOverall);
    const conflicts = buildConflictsList({
        loc,
        composite: composite || snap?.composites?.intraday,
        flow,
        frame: null,
    });
    const trigger =
        setup && setup.lifecycle === "active"
            ? {
                  type: setup.type || null,
                  side: setup.side || null,
                  createdAt: setup.createdAt || null,
                  touchEvidence: setup.touchEvidence || null,
                  reasons: (setup.reasons || []).slice(0, 3),
              }
            : null;

    const changePct =
        priceChangePct ?? snap?.price?.changePct24h ?? null;

    const decision = buildDecision({
        loc,
        setup,
        obstacles,
        conflicts,
        flow,
        priceChangePct: changePct,
        btcChangePct24h,
        canFlowLink,
        now,
    });

    return {
        version: CONTEXT_VERSION,
        waiting: waiting.text
            ? { text: waiting.text, entryState: waiting.entryState, touchEvidence: waiting.touchEvidence }
            : null,
        waitingReason: waiting.text ? null : waiting.reason,
        trigger,
        obstacles,
        decision,
        positionSummary: {
            tags: loc?.positionTags || [],
            supportNear: loc?.support?.nearFar || null,
            resistanceNear: loc?.resistance?.nearFar || null,
            supportDistPct: loc?.support?.distancePct ?? null,
            resistanceDistPct: loc?.resistance?.distancePct ?? null,
        },
    };
}

function pickActiveScenarios(setups, timeframe, candleCloseTime, candleIndexHint) {
    const active = (setups || []).filter((s) => s.lifecycle === "active");
    const bySide = { long: null, short: null };
    for (const s of active) {
        const side = s.side === "long" || s.side === "short" ? s.side : null;
        if (!side) continue;
        if (!bySide[side]) bySide[side] = s;
    }
    const scenarios = [];
    for (const side of ["long", "short"]) {
        const s = bySide[side];
        if (!s) continue;
        scenarios.push({
            id: s.id,
            side: s.side,
            type: s.type,
            lifecycle: s.lifecycle,
            entryState: s.entryState,
            entryNote: "in_entry nghĩa là giá trong band — không phải fill lệnh",
            entryLow: s.entryLow,
            entryHigh: s.entryHigh,
            invalidationLevel: s.invalidationLevel ?? null,
            expiresAtIndex: s.expiresAtIndex ?? null,
            expiresAt: estimateExpiresAt(s, timeframe, candleCloseTime),
            barsRemaining: barsRemaining(s, candleIndexHint),
            expiryBarsDefault: SETUP_EXPIRY_BARS,
            createdAt: s.createdAt || null,
            firstTouchedAt: s.firstTouchedAt || null,
            touchEvidence: s.touchEvidence || null,
            reasons: (s.reasons || []).slice(0, 4),
            trigger: {
                kind: s.type,
                description: (s.reasons || [])[0] || s.type,
                createdAt: s.createdAt || null,
            },
            version: s.version || SETUP_VERSION,
        });
    }
    return scenarios;
}

function buildEvidenceList({ loc, frame, composite, flow }) {
    const items = [];
    for (const c of loc?.confirmations || []) {
        items.push({
            id: `conf_${c.id}`,
            text: c.label || c.id,
            asOf: loc?.calculatedAt || null,
            source: "location.confirmations",
            version: CONTEXT_VERSION,
        });
    }
    const setup = loc?.primarySetup;
    if (setup?.lifecycle === "active") {
        for (const r of (setup.reasons || []).slice(0, 2)) {
            items.push({
                id: `setup_${items.length}`,
                text: r,
                asOf: setup.createdAt || loc?.calculatedAt || null,
                source: "setup.reasons",
                version: setup.version || SETUP_VERSION,
            });
        }
    }
    if (frame?.bias && frame.bias !== "wait") {
        items.push({
            id: "frame_bias",
            text: `Bias khung ${loc?.timeframe || "?"}: ${frame.bias} (L ${frame.longScore ?? "—"} / S ${frame.shortScore ?? "—"})`,
            asOf: frame.candleCloseTime || null,
            source: "score-frame",
            version: FORMULA_VERSION,
        });
    }
    if (composite?.eligible && composite?.lean) {
        items.push({
            id: "composite_lean",
            text: `Composite ${composite.lean}`,
            asOf: null,
            source: "composite",
            version: FORMULA_VERSION,
        });
    }
    if (flow?.bias && !flow.stale) {
        items.push({
            id: "flow_bias",
            text: `Flow quan sát: ${flow.bias} (không cộng vào technical score)`,
            asOf: flow.collectedAt || null,
            source: "smart-money",
            version: CONTEXT_VERSION,
        });
    }
    return items.slice(0, 3);
}

function buildConflictsList({ loc, composite, flow, frame }) {
    const items = [];
    if (structureHtfConflict(loc?.structureBias, loc?.htfBias)) {
        items.push({
            id: "htf_vs_structure",
            text: `Cấu trúc ${loc.structureLabel || loc.structureBias} khác HTF ${loc.htfLabel || loc.htfBias}`,
            asOf: loc?.calculatedAt || null,
            source: "location",
            version: CONTEXT_VERSION,
        });
    }
    if (composite?.conflict) {
        items.push({
            id: "composite_conflict",
            text: "Điểm Long và Short cùng mạnh (conflict)",
            asOf: null,
            source: "composite",
            version: FORMULA_VERSION,
        });
    }
    if (loc?.positionTags?.includes("conflict")) {
        items.push({
            id: "sr_squeeze",
            text: "Giá nằm giữa hỗ trợ và kháng cự gần",
            asOf: loc?.priceAsOf || null,
            source: "location.positionTags",
            version: CONTEXT_VERSION,
        });
    }
    if (flow?.stale) {
        items.push({
            id: "flow_stale",
            text: "Flow stale — không dùng làm bằng chứng đồng thuận",
            asOf: flow.collectedAt || null,
            source: "smart-money",
            version: CONTEXT_VERSION,
        });
    } else if (flow?.bias && loc?.primarySetup?.side) {
        const setupSide = loc.primarySetup.side;
        const flowBias = String(flow.bias).toLowerCase();
        if (
            (setupSide === "long" && (flowBias.includes("short") || flowBias.includes("sell"))) ||
            (setupSide === "short" && (flowBias.includes("long") || flowBias.includes("buy")))
        ) {
            items.push({
                id: "flow_vs_setup",
                text: `Flow ${flow.bias} ngược hướng setup ${setupSide} (quan sát, không phải cá voi)`,
                asOf: flow.collectedAt || null,
                source: "smart-money",
                version: CONTEXT_VERSION,
            });
        }
    }
    if (loc?.priceFresh === false) {
        items.push({
            id: "price_not_fresh",
            text: "Giá không fresh — vị trí có thể lệch",
            asOf: loc?.priceAsOf || null,
            source: "price",
            version: CONTEXT_VERSION,
        });
    }
    if (frame?.quality?.overall === "stale" || frame?.quality?.overall === "warming") {
        items.push({
            id: "frame_quality",
            text: `Chất lượng khung phân tích: ${frame.quality.overall}`,
            asOf: frame.candleCloseTime || null,
            source: "score-frame",
            version: FORMULA_VERSION,
        });
    }
    return items.slice(0, 3);
}

/**
 * Decision context cho panel coin.
 */
function buildDecisionContext({
    snap,
    loc,
    composite,
    frame,
    flow,
    analysisTf,
    setups,
} = {}) {
    const tf = analysisTf || loc?.timeframe || "1h";
    const setupList = setups || loc?.setups || [];
    const scenarios = pickActiveScenarios(setupList, tf, loc?.candleCloseTime, null);
    const evidence = buildEvidenceList({ loc, frame, composite, flow });
    const conflicts = buildConflictsList({ loc, composite, flow, frame });
    const q = mapDomainQuality(loc?.quality || snap?.qualityOverall);

    return {
        version: CONTEXT_VERSION,
        formulaVersion: FORMULA_VERSION,
        analysisTf: tf,
        asOf: loc?.calculatedAt || snap?.calculatedAt || null,
        quality: q.quality,
        reason: q.reason,
        positioning: {
            price: loc?.price ?? snap?.price?.last ?? null,
            priceAsOf: loc?.priceAsOf || snap?.price?.asOf || null,
            priceSource: loc?.priceSource || snap?.price?.source || null,
            priceFresh: loc?.priceFresh ?? null,
            structureBias: loc?.structureBias || null,
            structureLabel: loc?.structureLabel || null,
            htfBias: loc?.htfBias || null,
            htfLabel: loc?.htfLabel || null,
            support: loc?.support || null,
            resistance: loc?.resistance || null,
            positionTags: loc?.positionTags || [],
        },
        scenarios,
        evidence,
        conflicts,
        note:
            scenarios.length === 0
                ? "Chưa có setup active — kết quả hợp lệ, không phải lỗi."
                : "Hai hướng Long/Short độc lập nếu cùng active; không trung bình entry.",
    };
}

/** Primary setup summary fields additive (invalidation / expiry / touch). */
function enrichPrimarySetupFields(setup, timeframe, candleCloseTime) {
    if (!setup) return null;
    return {
        ...setup,
        invalidationLevel: setup.invalidationLevel ?? null,
        touchEvidence: setup.touchEvidence ?? null,
        expiresAtIndex: setup.expiresAtIndex ?? null,
        expiresAt: setup.expiresAt || estimateExpiresAt(setup, timeframe, candleCloseTime),
        firstTouchedAt: setup.firstTouchedAt ?? null,
    };
}

module.exports = {
    CONTEXT_VERSION,
    DECISION_VERSION,
    BTC_CONTEXT_TF,
    envelope,
    mapDomainQuality,
    atrPctFromFrame,
    estimateExpiresAt,
    buildOverviewContext,
    buildRowContext,
    buildDecisionContext,
    enrichPrimarySetupFields,
    waitingCopy,
    buildObstacles,
    countSetupsOnSnaps,
};
