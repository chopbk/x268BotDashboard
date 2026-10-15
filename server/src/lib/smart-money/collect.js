/**
 * Thu thập từng nguồn độc lập — lỗi SM không làm mất OI/funding.
 */
const { buildSnapshot } = require("./normalize");
const { fetchOpenInterest } = require("./adapters/open-interest");
const { fetchFunding } = require("./adapters/funding");
const { fetchTopTraderBundle } = require("./adapters/top-trader");
const { fetchSmartMoneyOverview } = require("./adapters/smart-money-bapi");
const { getLatestSnapshot, saveLatestSnapshot, appendHistory } = require("./store");

async function safe(name, fn, metrics) {
    const t0 = Date.now();
    try {
        const result = await fn();
        metrics.sources[name] = { ok: Boolean(result?.ok), ms: Date.now() - t0, reason: result?.reason || null };
        return result;
    } catch (error) {
        metrics.sources[name] = {
            ok: false,
            ms: Date.now() - t0,
            code: error.code || null,
            host: error.host || null,
            error: String(error.message || error).slice(0, 200),
        };
        // Chỉ fapi/futuresData cooldown mới bubble (cần giãn toàn cycle).
        // bapi cooldown đã được adapter SM nuốt thành reason=cooldown.
        if ((error.code === "COOLDOWN" || error.code === "RATE_LIMIT") && error.host !== "bapi") {
            throw error;
        }
        return {
            ok: false,
            reason: error.code === "COOLDOWN" || error.code === "RATE_LIMIT" ? "cooldown" : "source_error",
            error: error.message,
            retryAfterMs: error.retryAfterMs || null,
        };
    }
}

function carryOi(previous, markStale = true) {
    if (previous?.openInterest?.status !== "ok") return null;
    // Giữ nguyên block OI (kể cả delta) — không đặt prevQty=qty (làm deltaPct=0 giả).
    return {
        ok: true,
        _staleCarry: Boolean(markStale),
        _reuseBlock: previous.openInterest,
        data: null,
    };
}

function carryFunding(previous, markStale = true) {
    if (previous?.funding?.status !== "ok") return null;
    const { status, ...rest } = previous.funding;
    return { ok: true, _staleCarry: Boolean(markStale), data: rest };
}

function carryTop(previous, markStale = true) {
    if (previous?.topTrader?.status !== "ok") return null;
    return {
        ok: true,
        _staleCarry: Boolean(markStale),
        data: {
            period: previous.topTrader.period,
            accountLsr: previous.topTrader.accountLsr,
            positionLsr: previous.topTrader.positionLsr,
            accountLongPct: previous.topTrader.accountLongPct,
            accountShortPct: previous.topTrader.accountShortPct,
            positionLongPct: previous.topTrader.positionLongPct,
            positionShortPct: previous.topTrader.positionShortPct,
            takerBuySellRatio: previous.taker?.buySellRatio,
            takerBuyVol: previous.taker?.buyVol,
            takerSellVol: previous.taker?.sellVol,
            periodEnd: previous.topTrader.periodEnd,
            sourceUpdatedAt: previous.topTrader.sourceUpdatedAt,
        },
    };
}

function carrySmartMoney(previous, markStale = true) {
    if (previous?.smartMoney?.status !== "ok") return null;
    return {
        ok: true,
        _staleCarry: Boolean(markStale),
        data: {
            cohortId: previous.smartMoney.cohortId,
            signalDay: previous.smartMoney.signalDay,
            sourceUpdatedAt: previous.smartMoney.sourceUpdatedAt,
            traders: previous.smartMoney.traders,
            whales: previous.smartMoney.whales,
            longShortRatio: previous.smartMoney.longShortRatio,
        },
    };
}

function carryPrice(previous) {
    if (previous?.price?.status !== "ok" && previous?.price?.mark == null) return null;
    return {
        lastPrice: previous.price.mark ?? null,
        priceChangePercent: previous.price.changePct24h ?? null,
        quoteVolume: previous.price.quoteVolume24h ?? null,
    };
}

/**
 * @param {string} symbol
 * @param {{ price?: object, tracking?: object, parts?: string[] }} opts
 */
async function collectSymbol(symbol, opts = {}) {
    const sym = String(symbol).toUpperCase();
    const metrics = { symbol: sym, sources: {} };
    const previous = await getLatestSnapshot(sym);
    const parts = new Set(opts.parts || ["oi", "funding", "top", "smartMoney"]);

    let oi = null;
    let funding = null;
    let topTrader = null;
    let smartMoney = null;

    // Chỉ fetch phần due; phần không gọi phải giữ snapshot cũ — tránh ghi đè SM=missing khi chỉ cập nhật OI.
    if (parts.has("oi")) oi = await safe("oi", () => fetchOpenInterest(sym), metrics);
    else oi = carryOi(previous, false);
    if (parts.has("funding")) funding = await safe("funding", () => fetchFunding(sym), metrics);
    else funding = carryFunding(previous, false);
    if (parts.has("top")) topTrader = await safe("top", () => fetchTopTraderBundle(sym, "1h"), metrics);
    else topTrader = carryTop(previous, false);
    if (parts.has("smartMoney")) smartMoney = await safe("smartMoney", () => fetchSmartMoneyOverview(sym), metrics);
    else smartMoney = carrySmartMoney(previous, false);

    if (oi && !oi.ok) oi = carryOi(previous, true) || oi;
    if (funding && !funding.ok) funding = carryFunding(previous, true) || funding;
    if (topTrader && !topTrader.ok) topTrader = carryTop(previous, true) || topTrader;
    if (smartMoney && !smartMoney.ok) smartMoney = carrySmartMoney(previous, true) || smartMoney;

    const collectedAt = new Date().toISOString();
    const snapshot = buildSnapshot({
        symbol: sym,
        tracking: opts.tracking || previous?.tracking || { active: true, sources: [] },
        collectedAt,
        price: opts.price || carryPrice(previous),
        oi,
        funding,
        topTrader,
        smartMoney,
        previous,
    });

    const carried =
        Boolean(oi?._staleCarry) ||
        Boolean(funding?._staleCarry) ||
        Boolean(topTrader?._staleCarry) ||
        Boolean(smartMoney?._staleCarry);
    if (carried) {
        snapshot.quality.stale = true;
        if (snapshot.quality.overall === "ok" || snapshot.quality.overall === "partial") {
            snapshot.quality.overall = "stale";
        }
    }

    await saveLatestSnapshot(snapshot);
    const freshOk =
        (oi && oi.ok && !oi._staleCarry) ||
        (funding && funding.ok && !funding._staleCarry) ||
        (topTrader && topTrader.ok && !topTrader._staleCarry) ||
        (smartMoney && smartMoney.ok && !smartMoney._staleCarry) ||
        Boolean(opts.price);
    if (freshOk) await appendHistory(snapshot);

    return { snapshot, metrics, previous };
}

module.exports = { collectSymbol };
