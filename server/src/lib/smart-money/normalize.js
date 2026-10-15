const { SCHEMA_VERSION, FORMULA_VERSION } = require("./config");
const {
    deltaQty,
    deltaPct,
    profitRatioPct,
    distanceToEntryPct,
    notionalFromQtyPrice,
    biasFromLongShort,
    finite,
} = require("./formulas");

function emptySideStats() {
    return {
        longCount: null,
        shortCount: null,
        longQty: null,
        shortQty: null,
        longAvgEntry: null,
        shortAvgEntry: null,
        longProfitCount: null,
        shortProfitCount: null,
        longProfitRatioPct: null,
        shortProfitRatioPct: null,
        longNotional: null,
        shortNotional: null,
    };
}

function enrichSide(side) {
    const s = { ...emptySideStats(), ...(side || {}) };
    s.longProfitRatioPct = profitRatioPct(s.longProfitCount, s.longCount);
    s.shortProfitRatioPct = profitRatioPct(s.shortProfitCount, s.shortCount);
    s.longNotional = notionalFromQtyPrice(s.longQty, s.longAvgEntry);
    s.shortNotional = notionalFromQtyPrice(s.shortQty, s.shortAvgEntry);
    return s;
}

function qualityFromParts(parts) {
    const missing = [];
    let stale = false;
    let overall = "ok";
    for (const [key, part] of Object.entries(parts)) {
        if (!part || part.status === "missing") missing.push(key);
        if (part?.status === "stale") stale = true;
        if (part?.status === "source_error" || part?.status === "cooldown") overall = "degraded";
        if (part?.status === "warming") overall = overall === "ok" ? "warming" : overall;
    }
    if (missing.length && overall === "ok") overall = "partial";
    if (stale && overall === "ok") overall = "stale";
    return { overall, stale, missing };
}

/**
 * Ghép các adapter độc lập thành snapshot chuẩn.
 * previous: snapshot trước (để delta + cohort compare).
 */
function buildSnapshot({
    symbol,
    tracking = {},
    collectedAt = new Date().toISOString(),
    price = null,
    oi = null,
    funding = null,
    topTrader = null,
    smartMoney = null,
    previous = null,
}) {
    const parts = {};
    const priceBlock =
        price && (price.lastPrice != null || price.quoteVolume != null)
            ? {
                  mark: price.lastPrice ?? null,
                  changePct24h: price.priceChangePercent ?? null,
                  quoteVolume24h: price.quoteVolume ?? null,
                  status: "ok",
              }
            : { mark: null, changePct24h: null, quoteVolume24h: null, status: "missing" };
    parts.price = priceBlock;

    let oiBlock = {
        qty: null,
        notional: null,
        deltaQty: null,
        deltaNotional: null,
        deltaPct: null,
        periodStart: null,
        periodEnd: null,
        status: "missing",
    };
    if (oi?._reuseBlock && oi._reuseBlock.status === "ok") {
        oiBlock = { ...oi._reuseBlock };
    } else if (oi?.ok && oi.data) {
        oiBlock = {
            qty: oi.data.qty,
            notional: oi.data.notional,
            deltaQty: deltaQty(oi.data.qty, oi.data.prevQty),
            deltaNotional: deltaQty(oi.data.notional, oi.data.prevNotional),
            deltaPct: deltaPct(oi.data.qty, oi.data.prevQty),
            periodStart: oi.data.periodStart,
            periodEnd: oi.data.periodEnd,
            sourceUpdatedAt: oi.data.sourceUpdatedAt,
            status: "ok",
        };
    } else if (oi && !oi.ok) {
        oiBlock.status = oi.reason || "source_error";
    }
    parts.openInterest = oiBlock;

    let fundingBlock = {
        currentRate: null,
        lastSettledRate: null,
        lastSettledAt: null,
        nextFundingTime: null,
        intervalHours: null,
        sourceUpdatedAt: null,
        status: "missing",
    };
    if (funding?.ok && funding.data) {
        fundingBlock = { ...funding.data, status: "ok" };
    } else if (funding && !funding.ok) {
        fundingBlock.status = funding.reason || "source_error";
    }
    parts.funding = fundingBlock;

    let topBlock = {
        period: "1h",
        accountLsr: null,
        positionLsr: null,
        accountLongPct: null,
        accountShortPct: null,
        positionLongPct: null,
        positionShortPct: null,
        periodEnd: null,
        status: "missing",
    };
    let takerBlock = {
        buySellRatio: null,
        buyVol: null,
        sellVol: null,
        period: "1h",
        periodEnd: null,
        status: "missing",
    };
    if (topTrader?.ok && topTrader.data) {
        const d = topTrader.data;
        topBlock = {
            period: d.period,
            accountLsr: d.accountLsr,
            positionLsr: d.positionLsr,
            accountLongPct: d.accountLongPct,
            accountShortPct: d.accountShortPct,
            positionLongPct: d.positionLongPct,
            positionShortPct: d.positionShortPct,
            periodEnd: d.periodEnd,
            sourceUpdatedAt: d.sourceUpdatedAt,
            status: "ok",
        };
        if (d.takerBuySellRatio != null || d.takerBuyVol != null) {
            takerBlock = {
                buySellRatio: d.takerBuySellRatio,
                buyVol: d.takerBuyVol,
                sellVol: d.takerSellVol,
                period: d.period,
                periodEnd: d.periodEnd,
                status: "ok",
            };
        } else if (d.partial?.taker) {
            takerBlock.status = d.partial.taker;
        }
    } else if (topTrader && !topTrader.ok) {
        topBlock.status = topTrader.reason || "source_error";
        takerBlock.status = topTrader.reason || "source_error";
    }
    parts.topTrader = topBlock;
    parts.taker = takerBlock;

    const prevSm = previous?.smartMoney || null;
    let smBlock = {
        cohortId: null,
        signalDay: null,
        sourceUpdatedAt: null,
        comparable: false,
        traders: enrichSide(null),
        whales: enrichSide(null),
        status: "missing",
    };
    if (smartMoney?.ok && smartMoney.data) {
        const d = smartMoney.data;
        const prevCohort = prevSm?.cohortId || null;
        const comparable = prevCohort != null && d.cohortId != null && prevCohort === d.cohortId;
        smBlock = {
            cohortId: d.cohortId,
            signalDay: d.signalDay,
            sourceUpdatedAt: d.sourceUpdatedAt,
            comparable,
            traders: enrichSide(d.traders),
            whales: enrichSide(d.whales),
            longShortRatio: d.longShortRatio ?? null,
            status: "ok",
        };
    } else if (smartMoney && !smartMoney.ok) {
        smBlock.status = smartMoney.reason || "source_error";
    }
    parts.smartMoney = smBlock;

    const mark = priceBlock.mark;
    const derived = {
        bias: biasFromLongShort(smBlock.traders.longQty, smBlock.traders.shortQty),
        whaleBias: biasFromLongShort(smBlock.whales.longQty, smBlock.whales.shortQty),
        deltas: {
            tradersLongQty: smBlock.comparable ? deltaQty(smBlock.traders.longQty, prevSm?.traders?.longQty) : null,
            tradersShortQty: smBlock.comparable ? deltaQty(smBlock.traders.shortQty, prevSm?.traders?.shortQty) : null,
            whalesLongQty: smBlock.comparable ? deltaQty(smBlock.whales.longQty, prevSm?.whales?.longQty) : null,
            whalesShortQty: smBlock.comparable ? deltaQty(smBlock.whales.shortQty, prevSm?.whales?.shortQty) : null,
            tradersLongQtyPct: smBlock.comparable ? deltaPct(smBlock.traders.longQty, prevSm?.traders?.longQty) : null,
            whalesLongQtyPct: smBlock.comparable ? deltaPct(smBlock.whales.longQty, prevSm?.whales?.longQty) : null,
            oiQty: oiBlock.deltaQty,
            oiPct: oiBlock.deltaPct,
            cohortReset: smBlock.status === "ok" && prevSm?.cohortId && smBlock.cohortId && prevSm.cohortId !== smBlock.cohortId,
        },
        distanceToWhaleEntryPct: {
            long: distanceToEntryPct(mark, smBlock.whales.longAvgEntry, "LONG"),
            short: distanceToEntryPct(mark, smBlock.whales.shortAvgEntry, "SHORT"),
            longRaw: distanceToEntryPct(mark, smBlock.whales.longAvgEntry, null),
            shortRaw: distanceToEntryPct(mark, smBlock.whales.shortAvgEntry, null),
        },
        distanceToTraderEntryPct: {
            long: distanceToEntryPct(mark, smBlock.traders.longAvgEntry, "LONG"),
            short: distanceToEntryPct(mark, smBlock.traders.shortAvgEntry, "SHORT"),
        },
        formulaVersion: FORMULA_VERSION,
    };

    // Giá tăng nhưng qty không đổi → delta qty null/0, không suy "tăng vị thế".
    if (finite(derived.deltas.tradersLongQty) === 0) {
        // giữ 0 hợp lệ (không đổi), không đổi thành tăng.
    }

    return {
        schemaVersion: SCHEMA_VERSION,
        symbol: String(symbol).toUpperCase(),
        tracking: {
            active: tracking.active !== false,
            sources: tracking.sources || [],
            label: tracking.active === false ? "Không còn theo dõi" : null,
        },
        collectedAt,
        quality: qualityFromParts(parts),
        price: priceBlock,
        openInterest: oiBlock,
        funding: fundingBlock,
        topTrader: topBlock,
        taker: takerBlock,
        smartMoney: smBlock,
        derived,
        events: [],
        candidateHints: [],
    };
}

module.exports = { buildSnapshot, enrichSide, qualityFromParts };
