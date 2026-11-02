const { envelope, nowMs } = require("./provenance");

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
    const n = num(value);
    if (n == null) return null;
    return Number(n.toFixed(digits));
}

/**
 * Exposure account = sổ sàn một lần; attribution config = own qty.
 * Không cộng exchange qty theo monitor.
 */
function buildPortfolioSnapshot({
    username,
    positions = [],
    wallet = null,
    openOrders = [],
    reservations = [],
    cashflows = null,
    equityStartUtc = null,
} = {}) {
    const missingFields = [];
    const rows = Array.isArray(positions) ? positions : [];

    let gross = 0;
    let net = 0;
    let longNotional = 0;
    let shortNotional = 0;
    let coveredRisk = 0;
    let unprotectedQty = 0;
    let unknownRiskQty = 0;
    const bySymbol = new Map();
    const attribution = [];

    for (const row of rows) {
        const qty = Math.abs(num(row.qty ?? row.positionAmt ?? row.size) || 0);
        const mark = num(row.mark ?? row.markPrice);
        const entry = num(row.entry ?? row.entryPrice);
        const side = String(row.side || row.positionSide || "").toUpperCase();
        const s = side === "SHORT" ? -1 : 1;
        const notional = mark != null ? qty * mark : null;
        if (notional == null) {
            missingFields.push(`mark:${row.symbol || "?"}`);
            continue;
        }
        gross += Math.abs(notional);
        net += s * notional;
        if (s > 0) longNotional += Math.abs(notional);
        else shortNotional += Math.abs(notional);

        const stop = num(row.exchangeSl ?? row.stopLoss ?? row.sl);
        if (stop != null && entry != null) {
            coveredRisk += Math.max(0, -s * qty * (stop - entry));
        } else if (qty > 0) {
            unprotectedQty += qty;
            unknownRiskQty += qty;
        }

        const sym = String(row.symbol || "").toUpperCase();
        const prev = bySymbol.get(sym) || { symbol: sym, notional: 0, qty: 0 };
        prev.notional += Math.abs(notional);
        prev.qty += qty;
        bySymbol.set(sym, prev);

        for (const mon of row.monitors || []) {
            const own = Math.abs(num(mon.ownQty ?? mon.positionAmt) || 0);
            if (!(own > 0)) continue;
            attribution.push({
                env: mon.env || null,
                signal: mon.signal || mon.type || null,
                symbol: sym,
                side,
                ownQty: own,
                exchangeQty: qty,
                note: "own_qty_only",
            });
        }
    }

    // Reader: balance = walletBalance (không gồm uPnL). equity chỉ dùng khi nguồn cung cấp rõ.
    const walletBalance = num(wallet?.walletBalance ?? wallet?.balance);
    const hasExplicitEquity = wallet?.equity != null || wallet?.equityBalance != null;
    const equity = hasExplicitEquity
        ? num(wallet?.equity ?? wallet?.equityBalance)
        : walletBalance;
    const equityBasis = hasExplicitEquity ? "equity_incl_upnl_or_provided" : "wallet_balance_only";
    const available = num(wallet?.available ?? wallet?.availableBalance);
    if (walletBalance == null) missingFields.push("walletBalance");
    if (equity == null) missingFields.push("equity");
    if (available == null) missingFields.push("available");
    if (!hasExplicitEquity && walletBalance != null) {
        missingFields.push("equity_not_provided_used_wallet");
    }
    if (wallet?.stale === true || wallet?.source === "none") {
        missingFields.push("wallet_stale_or_missing");
    }
    if (wallet?.error) missingFields.push("wallet_error");

    const leverageEff = equity != null && equity > 0 ? round(gross / equity, 4) : null;

    let dailyLoss = null;
    let dailyLossQuality = "missing";
    // Không dùng num(null) — Number(null)===0 sẽ giả start equity.
    const startEq = equityStartUtc == null || equityStartUtc === ""
        ? null
        : num(equityStartUtc);
    const netFlows = cashflows == null
        ? null
        : num(cashflows?.netExternalFlows);
    if (equity != null && startEq != null && netFlows != null) {
        dailyLoss = Math.max(0, -(equity - startEq - netFlows));
        dailyLossQuality = "fresh";
    } else if (equity != null && startEq != null) {
        dailyLossQuality = "partial";
        missingFields.push("cashflows");
    } else {
        missingFields.push("equityStartUtc");
    }

    const pendingNotional = (openOrders || []).reduce((s, o) => {
        const q = Math.abs(num(o.origQty ?? o.quantity) || 0);
        const px = num(o.price ?? o.stopPrice ?? o.mark);
        if (!(q > 0) || !(px > 0)) return s;
        if (o.reduceOnly === true) return s;
        return s + q * px;
    }, 0);

    const reservedNotional = (reservations || [])
        .filter((r) => ["reserved", "submitted", "unknown", "partial"].includes(r.status))
        .reduce((s, r) => s + Math.abs(num(r.notionalNeed) || 0), 0);

    const quality = missingFields.length
        ? (rows.length ? "partial" : "missing")
        : "fresh";

    return {
        username: username || null,
        walletBalance: walletBalance != null ? round(walletBalance, 4) : null,
        equity: equity != null ? round(equity, 4) : null,
        equityBasis,
        available: available != null ? round(available, 4) : null,
        walletStale: wallet?.stale === true || wallet?.source === "none",
        walletError: wallet?.error ? String(wallet.error).slice(0, 200) : null,
        walletSource: wallet?.source || null,
        walletAt: wallet?.at || null,
        gross: round(gross, 4),
        net: round(net, 4),
        longNotional: round(longNotional, 4),
        shortNotional: round(shortNotional, 4),
        leverageEff,
        coveredRiskAtStop: round(coveredRisk, 4),
        unprotectedQty: round(unprotectedQty, 6),
        unknownRiskQty: round(unknownRiskQty, 6),
        bySymbol: [...bySymbol.values()].map((x) => ({
            ...x,
            notional: round(x.notional, 4),
            qty: round(x.qty, 6),
        })),
        attribution,
        pendingEntryNotional: round(pendingNotional, 4),
        reservedNotional: round(reservedNotional, 4),
        dailyLoss: dailyLoss != null ? round(dailyLoss, 4) : null,
        dailyLossQuality,
        openPositions: rows.length,
        provenance: envelope({
            source: "risk-portfolio",
            receivedAt: nowMs(),
            computedAt: nowMs(),
            quality,
            missingFields: [...new Set(missingFields)],
            coverage: {
                accountingBasis: "exchange_book_once",
                attribution: "own_qty_only",
                livePaperSeparated: true,
                equityBasis,
            },
        }),
    };
}

function buildShockScenarios(snapshot, { btcShocks = [0.03, 0.05, 0.1] } = {}) {
    if (!snapshot || snapshot.provenance?.quality === "missing") {
        return {
            scenarios: [],
            quality: "missing",
            note: "insufficient_portfolio_data",
        };
    }
    const betaHint = 1;
    const scenarios = btcShocks.flatMap((shock) => {
        const signed = [-shock, shock];
        return signed.map((pct) => {
            const est = (snapshot.net || 0) * betaHint * pct;
            return {
                id: `btc_${pct > 0 ? "up" : "down"}_${Math.round(Math.abs(pct) * 100)}`,
                kind: "btc_shock",
                shockPct: pct,
                estimatedPnl: round(est, 2),
                assumption: "beta≈1 placeholder; not a liquidation probability",
                quality: "partial",
            };
        });
    });
    return { scenarios, quality: "partial", note: "beta_estimate_only" };
}

module.exports = {
    buildPortfolioSnapshot,
    buildShockScenarios,
};
