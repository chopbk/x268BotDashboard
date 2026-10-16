const AccountStatic = require("../models/account-static");
const SignalInfo = require("../models/signal-info");

const DAY_MS = 24 * 60 * 60 * 1000;
const TRADE_CAP = 2000;
const SIGNAL_CAP = 4000;
const MATCH_WINDOW_MS = 45 * 60 * 1000;
const TOP_CURVES = 6;

function r3(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 1000) / 1000;
}

function r2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
}

function ymd(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function profitOk(value) {
    return value != null && Number.isFinite(Number(value));
}

function extractSignalPrice(info) {
    if (!info || typeof info !== "object") return null;
    const prices = info.prices && typeof info.prices === "object" ? info.prices : {};
    return num(prices.currentPrice)
        ?? num(prices.price)
        ?? num(prices.entryPrice)
        ?? num(info.currentPrice)
        ?? num(info.price)
        ?? null;
}

function tradeSignalPrice(row) {
    const stats = row?.stats && typeof row.stats === "object" ? row.stats : {};
    return num(stats.signalPrice)
        ?? num(stats.price)
        ?? num(stats.currentPrice)
        ?? num(stats.markAtOpen)
        ?? null;
}

function holdMs(row) {
    if (!row?.openTime || !row?.closeTime) return null;
    const open = new Date(row.openTime).getTime();
    const close = new Date(row.closeTime).getTime();
    if (!Number.isFinite(open) || !Number.isFinite(close) || close < open) return null;
    return close - open;
}

function formatHold(ms) {
    if (ms == null || !Number.isFinite(ms)) return null;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m`;
    const hour = Math.floor(min / 60);
    const rem = min % 60;
    return rem ? `${hour}h ${rem}m` : `${hour}h`;
}

function buildEquity(trades) {
    const sorted = [...(trades || [])].sort((a, b) => {
        const ta = new Date(a.closeTime || a.openTime || 0).getTime();
        const tb = new Date(b.closeTime || b.openTime || 0).getTime();
        return ta - tb;
    });
    const byDay = new Map();
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let wins = 0;
    let losses = 0;
    let flats = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let profitSum = 0;
    let valid = 0;
    let holdSum = 0;
    let holdCount = 0;

    for (const row of sorted) {
        if (!profitOk(row.profit)) continue;
        const profit = Number(row.profit);
        valid += 1;
        profitSum += profit;
        if (profit > 0) { wins += 1; grossWin += profit; }
        else if (profit < 0) { losses += 1; grossLoss += profit; }
        else flats += 1;
        const hold = holdMs(row);
        if (hold != null) { holdSum += hold; holdCount += 1; }

        cumulative = r3(cumulative + profit) || 0;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, r3(peak - cumulative) || 0);

        const day = ymd(row.closeTime || row.openTime || new Date());
        const prev = byDay.get(day) || { day, profit: 0, trades: 0, cumulative: 0 };
        prev.profit = r3(prev.profit + profit) || 0;
        prev.trades += 1;
        prev.cumulative = cumulative;
        byDay.set(day, prev);
    }

    const series = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    const rated = wins + losses + flats;
    let profitFactor = null;
    let profitFactorLabel = null;
    if (wins > 0 && losses > 0) profitFactor = r3(grossWin / Math.abs(grossLoss));
    else if (wins > 0 && losses === 0 && valid > 0) profitFactorLabel = "Không có lệnh lỗ";

    const avgHoldMs = holdCount ? Math.round(holdSum / holdCount) : null;
    return {
        series,
        metrics: {
            trades: sorted.length,
            valid,
            wins,
            losses,
            flats,
            winRate: rated ? r2((wins / rated) * 100) : null,
            profit: valid ? r3(profitSum) : null,
            avgProfit: valid ? r3(profitSum / valid) : null,
            expectancy: valid ? r3(profitSum / valid) : null,
            profitFactor,
            profitFactorLabel,
            maxDrawdown: valid ? r3(maxDrawdown) : null,
            maxDrawdownPct: peak > 0 ? r2((maxDrawdown / peak) * 100) : null,
            peakEquity: valid ? r3(peak) : null,
            avgHoldMs,
            avgHoldLabel: formatHold(avgHoldMs),
        },
    };
}

function groupKey(row, dim) {
    if (dim === "signal") return String(row.typeSignal || row.signal || "UNKNOWN").trim() || "UNKNOWN";
    if (dim === "env" || dim === "strategy") return String(row.env || "UNKNOWN").trim() || "UNKNOWN";
    return "account";
}

function buildGroups(trades, dim) {
    const map = new Map();
    for (const row of trades || []) {
        const key = groupKey(row, dim);
        const list = map.get(key) || [];
        list.push(row);
        map.set(key, list);
    }
    const groups = [...map.entries()].map(([name, rows]) => {
        const curve = buildEquity(rows);
        return { name, ...curve.metrics, series: curve.series };
    });
    return groups.sort((a, b) => Math.abs(Number(b.profit) || 0) - Math.abs(Number(a.profit) || 0)
        || (b.valid || 0) - (a.valid || 0));
}

function sideSign(side) {
    return String(side || "").toUpperCase() === "SHORT" ? -1 : 1;
}

function slippageBps(entry, signalPrice, side) {
    if (!(entry > 0) || !(signalPrice > 0)) return null;
    return r2(((entry - signalPrice) / signalPrice) * 10000 * sideSign(side));
}

function indexSignals(rows) {
    const byKey = new Map();
    for (const row of rows || []) {
        const signal = String(row.signal || "").trim().toUpperCase();
        const symbol = String(row.symbol || "").trim().toUpperCase();
        const side = String(row.side || "").trim().toUpperCase();
        if (!signal || !symbol) continue;
        const key = `${signal}|${symbol}|${side}`;
        const list = byKey.get(key) || [];
        list.push(row);
        byKey.set(key, list);
    }
    for (const list of byKey.values()) {
        list.sort((a, b) => new Date(a.openTime || 0).getTime() - new Date(b.openTime || 0).getTime());
    }
    return byKey;
}

function nearestSignal(index, trade) {
    const signal = String(trade.typeSignal || "").trim().toUpperCase();
    const symbol = String(trade.symbol || "").trim().toUpperCase();
    const side = String(trade.side || "").trim().toUpperCase();
    const list = index.get(`${signal}|${symbol}|${side}`) || [];
    if (!list.length) return null;
    const at = new Date(trade.openTime || 0).getTime();
    if (!Number.isFinite(at)) return null;
    let best = null;
    let bestGap = Infinity;
    for (const row of list) {
        const t = new Date(row.openTime || 0).getTime();
        if (!Number.isFinite(t)) continue;
        const gap = Math.abs(t - at);
        if (gap < bestGap) {
            bestGap = gap;
            best = row;
        }
    }
    if (!best || bestGap > MATCH_WINDOW_MS) return null;
    return best;
}

function buildFillQuality(trades, signalRows) {
    const index = indexSignals(signalRows);
    let limit = 0;
    let market = 0;
    let copy = 0;
    let matched = 0;
    let withPrice = 0;
    const slips = [];
    const samples = [];

    for (const row of trades || []) {
        if (row.isLimit) limit += 1;
        else market += 1;
        if (row.isCopy) copy += 1;

        let signalPrice = tradeSignalPrice(row);
        let source = signalPrice != null ? "stats" : null;
        if (signalPrice == null) {
            const info = nearestSignal(index, row);
            signalPrice = extractSignalPrice(info);
            if (signalPrice != null) source = "signal_infos";
        }
        const entry = num(row.entryPrice);
        if (signalPrice != null && entry != null) {
            withPrice += 1;
            matched += 1;
            const bps = slippageBps(entry, signalPrice, row.side);
            if (bps != null) {
                slips.push(bps);
                if (samples.length < 12) {
                    samples.push({
                        symbol: row.symbol,
                        signal: row.typeSignal,
                        side: row.side,
                        env: row.env,
                        entry,
                        signalPrice,
                        slippageBps: bps,
                        source,
                        openTime: row.openTime,
                    });
                }
            }
        }
    }

    const total = (trades || []).length;
    const absMean = slips.length
        ? r2(slips.reduce((sum, value) => sum + Math.abs(value), 0) / slips.length)
        : null;
    const mean = slips.length
        ? r2(slips.reduce((sum, value) => sum + value, 0) / slips.length)
        : null;

    return {
        trades: total,
        limitCount: limit,
        marketCount: market,
        copyCount: copy,
        limitRate: total ? r2((limit / total) * 100) : null,
        copyRate: total ? r2((copy / total) * 100) : null,
        matchedSignalPrice: withPrice,
        matchRate: total ? r2((withPrice / total) * 100) : null,
        avgSlippageBps: mean,
        avgAbsSlippageBps: absMean,
        samples: samples.sort((a, b) => Math.abs(b.slippageBps) - Math.abs(a.slippageBps)),
        note: withPrice
            ? "Slippage (bps) = (entry − giá signal) / giá signal × 10000 × chiều lệnh. Dương = vào kém hơn giá signal."
            : "Chưa khớp được giá signal (stats hoặc signal_infos.prices) nên chưa tính slippage; vẫn báo tỷ lệ limit/copy.",
    };
}

function emptyAttribution(meta = {}) {
    return {
        ...meta,
        account: { series: [], metrics: buildEquity([]).metrics },
        bySignal: [],
        byStrategy: [],
        fillQuality: buildFillQuality([], []),
        formulas: {
            equity: "PnL lệnh Account Static cộng dồn từ 0 theo closeTime UTC — không phải số dư ví.",
            maxDrawdown: "Đỉnh equity curve − đáy sau đó (USDT) trên chuỗi lệnh đang xem.",
            profitFactor: "Tổng profit dương / abs(tổng profit âm).",
            expectancy: "Trung bình profit mỗi lệnh có profit hợp lệ.",
            timeInTrade: "Trung bình closeTime − openTime.",
            slippage: "So entry với giá signal khi khớp được; thiếu giá thì để trống.",
        },
    };
}

async function loadSignalPrices(trades, from, to) {
    const names = [...new Set((trades || []).map((row) => String(row.typeSignal || "").trim()).filter(Boolean))];
    if (!names.length) return [];
    const looseFrom = new Date(new Date(from).getTime() - DAY_MS);
    const looseTo = new Date(new Date(to).getTime() + DAY_MS);
    try {
        return await SignalInfo.find({
            signal: { $in: names },
            openTime: { $gte: looseFrom, $lt: looseTo },
        })
            .select("signal symbol side openTime prices price currentPrice")
            .sort({ openTime: 1 })
            .limit(SIGNAL_CAP)
            .lean();
    } catch (error) {
        console.error("[loadSignalPrices]", error?.code || error?.name || "signal-infos");
        return [];
    }
}

async function loadAttribution({ envs, from, to, username = null }) {
    const accounts = [...new Set((envs || []).map((item) => String(item || "").trim()).filter(Boolean))];
    const meta = {
        username: username || null,
        from: from ? ymd(from) : null,
        to: to ? ymd(new Date(new Date(to).getTime() - 1)) : null,
        book: "live",
        truncated: false,
    };
    if (!accounts.length || !from || !to) return emptyAttribution(meta);

    let trades = [];
    try {
        trades = await AccountStatic.find({
            env: { $in: accounts },
            isPaper: { $ne: true },
            closeTime: { $gte: from, $lt: to },
            $or: [{ isClosed: true }, { closeTime: { $type: "date" } }],
        })
            .select("env typeSignal symbol side entryPrice closePrice profit openTime closeTime isLimit isCopy stats")
            .sort({ closeTime: 1, _id: 1 })
            .limit(TRADE_CAP)
            .lean();
    } catch (error) {
        console.error("[loadAttribution]", error?.code || error?.name || "account-statics");
        return emptyAttribution(meta);
    }

    meta.truncated = trades.length >= TRADE_CAP;
    const account = buildEquity(trades);
    const bySignal = buildGroups(trades, "signal").slice(0, 40);
    const byStrategy = buildGroups(trades, "env").slice(0, 40);
    const signalRows = await loadSignalPrices(trades, from, to);
    const fillQuality = buildFillQuality(trades, signalRows);

    return {
        ...meta,
        tradeCount: trades.length,
        account: {
            series: account.series,
            metrics: account.metrics,
        },
        bySignal,
        byStrategy,
        topCurves: {
            signal: bySignal.slice(0, TOP_CURVES).map(({ name, series, profit, maxDrawdown, expectancy }) => ({
                name, series, profit, maxDrawdown, expectancy,
            })),
            strategy: byStrategy.slice(0, TOP_CURVES).map(({ name, series, profit, maxDrawdown, expectancy }) => ({
                name, series, profit, maxDrawdown, expectancy,
            })),
        },
        fillQuality,
        formulas: emptyAttribution().formulas,
    };
}

function attentionFromAttribution(attribution, username) {
    const items = [];
    if (!attribution?.account?.metrics || !username) return items;
    const m = attribution.account.metrics;
    const href = `/reports?tab=ledger&username=${encodeURIComponent(username)}`;
    if (m.maxDrawdown != null && m.maxDrawdown >= 50 && (m.peakEquity || 0) > 0) {
        items.push({
            type: "drawdown",
            severity: m.maxDrawdownPct != null && m.maxDrawdownPct >= 35 ? "high" : "warn",
            title: `${username}: Max DD ${m.maxDrawdown}$ (${m.maxDrawdownPct ?? "—"}%) trên equity lệnh`,
            href,
        });
    }
    if (m.profitFactor != null && m.profitFactor < 1 && (m.valid || 0) >= 8) {
        items.push({
            type: "profit-factor",
            severity: "warn",
            title: `${username}: Profit factor ${m.profitFactor} (<1) trên ${m.valid} lệnh`,
            href,
        });
    }
    const worst = (attribution.bySignal || []).find((row) => Number(row.profit) < 0 && (row.valid || 0) >= 5);
    if (worst) {
        items.push({
            type: "signal-attribution",
            severity: Number(worst.profit) <= -30 ? "high" : "warn",
            title: `${username}: signal ${worst.name} ${worst.profit}$ · WR ${worst.winRate ?? "—"}%`,
            href: `/signals?view=statics&username=${encodeURIComponent(username)}&signal=${encodeURIComponent(worst.name)}`,
        });
    }
    const fq = attribution.fillQuality;
    if (fq?.avgAbsSlippageBps != null && fq.avgAbsSlippageBps >= 25 && (fq.matchedSignalPrice || 0) >= 5) {
        items.push({
            type: "slippage",
            severity: "warn",
            title: `${username}: |slippage| TB ${fq.avgAbsSlippageBps} bps so với giá signal`,
            href,
        });
    }
    return items;
}

module.exports = {
    r3,
    buildEquity,
    buildGroups,
    buildFillQuality,
    extractSignalPrice,
    slippageBps,
    loadAttribution,
    attentionFromAttribution,
    emptyAttribution,
    TRADE_CAP,
};
