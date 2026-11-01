const crypto = require("crypto");
const { httpError } = require("../http");
const { hashPayload, nowMs } = require("../provenance");

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function equalWeight(symbols = []) {
    const n = symbols.length;
    if (!n) return [];
    const w = 1 / n;
    return symbols.map((symbol) => ({ symbol, weight: w, method: "equal" }));
}

function fixedBudget(items = [], totalBudget) {
    const budget = num(totalBudget);
    if (!(budget > 0)) throw httpError(400, "Thiếu totalBudget");
    return items.map((it) => ({
        symbol: it.symbol,
        weight: num(it.weight) || 0,
        notional: (num(it.weight) || 0) * budget,
        method: "fixed",
    }));
}

function inverseVol(items = [], { window = 20 } = {}) {
    const vols = items.map((it) => ({
        symbol: it.symbol,
        vol: Math.max(num(it.volatility) || 0, 1e-8),
    }));
    const invSum = vols.reduce((s, v) => s + 1 / v.vol, 0);
    return vols.map((v) => ({
        symbol: v.symbol,
        weight: (1 / v.vol) / invSum,
        method: "inverse_vol",
        window,
    }));
}

function correlationCaps(weights, corrMatrix = {}, { maxCorr = 0.85 } = {}) {
    const breaches = [];
    const symbols = weights.map((w) => w.symbol);
    for (let i = 0; i < symbols.length; i += 1) {
        for (let j = i + 1; j < symbols.length; j += 1) {
            const a = symbols[i];
            const b = symbols[j];
            const c = num(corrMatrix[`${a}|${b}`] ?? corrMatrix[`${b}|${a}`]);
            if (c != null && c > maxCorr) {
                breaches.push({ a, b, corr: c, maxCorr });
            }
        }
    }
    return { ok: breaches.length === 0, breaches };
}

function buildProposal({
    method = "equal",
    symbols = [],
    items = [],
    totalBudget,
    current = [],
    corrMatrix,
    maxCorr,
    feeBps = 0,
    marketRevision = null,
    configRevision = null,
} = {}) {
    let target;
    if (method === "equal") target = equalWeight(symbols.length ? symbols : items.map((i) => i.symbol));
    else if (method === "fixed") target = fixedBudget(items, totalBudget);
    else if (method === "inverse_vol") target = inverseVol(items, { window: items[0]?.window || 20 });
    else throw httpError(400, "method không hỗ trợ");

    const corr = correlationCaps(target, corrMatrix, { maxCorr });
    const currentMap = new Map((current || []).map((c) => [c.symbol, num(c.weight) || 0]));
    let turnover = 0;
    const diffs = target.map((t) => {
        const cur = currentMap.get(t.symbol) || 0;
        const dw = Math.abs((t.weight || 0) - cur);
        turnover += dw;
        return { symbol: t.symbol, current: cur, target: t.weight, delta: (t.weight || 0) - cur };
    });
    const estCost = (turnover / 2) * (Number(feeBps) / 10000) * (num(totalBudget) || 0);

    const payload = {
        method,
        target,
        diffs,
        turnover,
        estimatedCost: estCost,
        correlation: corr,
        marketRevision,
        configRevision,
        createdAt: nowMs(),
    };
    return {
        proposalId: crypto.randomUUID(),
        revision: 1,
        status: "preview",
        payloadHash: hashPayload(payload),
        ...payload,
        staleWhen: "market_or_config_revision_changes",
        activation: {
            requiresPermission: "portfolio.allocate",
            requiresRiskGate: true,
            autoTrade: false,
        },
    };
}

function assertFresh(proposal, { marketRevision, configRevision } = {}) {
    if (!proposal) throw httpError(400, "Thiếu proposal");
    if (marketRevision != null && proposal.marketRevision != null
        && String(marketRevision) !== String(proposal.marketRevision)) {
        throw httpError(409, "Allocation preview stale (market)", { code: "source_changed" });
    }
    if (configRevision != null && proposal.configRevision != null
        && String(configRevision) !== String(proposal.configRevision)) {
        throw httpError(409, "Allocation preview stale (config)", { code: "source_changed" });
    }
    return true;
}

module.exports = {
    equalWeight,
    fixedBudget,
    inverseVol,
    correlationCaps,
    buildProposal,
    assertFresh,
};
