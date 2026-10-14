const { httpError } = require("../http");
const { canAccessBot } = require("../../middleware/auth");
const { PERMISSIONS } = require("../../auth/access-control");
const { getRiskProfile, serializeProfile } = require("../risk-profile");
const { getAccountBalance } = require("../account-balance-read");
const { buildMarketSnapshot, buildTechnicalBrief } = require("./market-snapshot");
const { computePositionMetrics } = require("./position-metrics");
const { computeAccountMetrics } = require("./account-metrics");
const { buildPositionScenarios, buildAccountScenarios } = require("./scenarios");
const { generateAiReport } = require("./ai-report");
const { makeSnapshotId, saveReport, listReports, latestAccountReport } = require("./report-store");
const { getLatestSnapshot } = require("../smart-money/store");
const { toMarketContext } = require("../smart-money/money-flow");
const { listEvents } = require("../smart-money/detector");
const { getCandidates } = require("../smart-money/candidates");

const lastJob = new Map();
const QUOTA_MS = 20_000;

function tradeKeyOf(account, symbol, side) {
    return `${String(account || "").trim()}|${String(symbol || "").trim().toUpperCase()}|${String(side || "").trim().toUpperCase()}`;
}

function checkQuota(actor, dedupeKey) {
    const id = String(actor?.id || "");
    const key = `${id}|${dedupeKey}`;
    const now = Date.now();
    const prev = lastJob.get(key) || 0;
    if (now - prev < QUOTA_MS) {
        const wait = Math.ceil((QUOTA_MS - (now - prev)) / 1000);
        const err = httpError(429, `Đợi ${wait}s rồi hỏi lại`, { retryAfter: wait });
        throw err;
    }
    lastJob.set(key, now);
    return key;
}

function assertBotAccess(actor, account, permission = PERMISSIONS.POSITIONS_VIEW) {
    const name = String(account || "").trim();
    if (!name) throw httpError(400, "Thiếu account");
    if (!canAccessBot(actor, name, permission)
        && !canAccessBot(actor, name, PERMISSIONS.STATISTICS_VIEW)) {
        throw httpError(403, "Không có quyền với bot này");
    }
    return name;
}

async function loadRisk(actor) {
    try {
        const { profile, configured } = await getRiskProfile(actor);
        return { profile, configured };
    } catch {
        return { profile: serializeProfile(null), configured: false };
    }
}

/**
 * Phân tích 1 vị thế — position từ client (đã scope) hoặc row Terminal.
 */
async function runPositionDecision(actor, body = {}, deps = {}) {
    const position = body.position && typeof body.position === "object" ? body.position : body;
    const account = assertBotAccess(actor, position.account);
    const symbol = String(position.symbol || "").trim().toUpperCase();
    const side = String(position.side || "").trim().toUpperCase();
    if (!symbol || !side) throw httpError(400, "Thiếu symbol/side");

    const dedupe = `${account}|${symbol}|${side}|position`;
    if (body.ai !== false) checkQuota(actor, dedupe);

    const { profile, configured: riskConfigured } = await loadRisk(actor);
    const market = await buildMarketSnapshot(symbol, {
        side,
        entry: position.entry,
        mark: position.mark,
        fetchImpl: deps.fetchImpl,
    });
    const metrics = computePositionMetrics(position, market);
    const { scenarios, missingForScenarios } = buildPositionScenarios(metrics, market, profile);
    const missingData = [
        ...new Set([
            ...(metrics.missingData || []),
            ...(missingForScenarios || []),
            ...(riskConfigured ? [] : ["risk_profile"]),
            ...(market.error ? ["market"] : []),
        ]),
    ];

    let riskLevelHint = "normal";
    if (metrics.mark == null || metrics.qty == null) riskLevelHint = "insufficient_data";
    else if (metrics.sl == null || (metrics.liqDistancePct != null && metrics.liqDistancePct < 5)) riskLevelHint = "high";
    else if (metrics.marketAlignment === "against" || (metrics.rrRemaining != null && metrics.rrRemaining < 1)) {
        riskLevelHint = "attention";
    }

    const asOf = new Date().toISOString();
    const snapshotId = makeSnapshotId({
        scope: "position",
        account,
        symbol,
        side,
        asOf,
        formulaVersion: "decision-v1",
    });

    const technicalBrief = buildTechnicalBrief(market, { side, symbol });

    let marketContext = { available: false, missing: ["smart_money_snapshot"] };
    try {
        const smSnap = await getLatestSnapshot(symbol);
        const events = smSnap ? await listEvents({ symbol, limit: 5 }) : [];
        const candDoc = await getCandidates().catch(() => null);
        const candItems = (candDoc?.items || []).filter((i) => i.symbol === symbol).slice(0, 3);
        marketContext = toMarketContext(smSnap, {
            events: events.map((e) => ({
                type: e.type,
                direction: e.direction,
                at: e.at,
                zScore: e.zScore,
                smallSample: e.smallSample,
                message: e.message,
            })),
            candidates: candItems,
        });
        if (!marketContext.available) missingData.push("smart_money");
    } catch (error) {
        console.warn("[runPositionDecision] marketContext", error.message || error);
        missingData.push("smart_money");
    }

    const snapshot = {
        scope: "position",
        account,
        symbol,
        side,
        metrics,
        market: market.error ? { error: market.error } : market,
        technicalBrief,
        marketContext,
        scenarios,
        riskProfile: riskConfigured ? profile : null,
        riskProfileConfigured: riskConfigured,
        missingData,
        riskLevelHint,
        snapshotId,
        asOf,
        formulaVersion: "decision-v1",
    };

    const report = await generateAiReport(snapshot, {
        fetchImpl: deps.fetchImpl,
        forceRules: body.ai === false,
    });

    // Fingerprint để UI biết báo cáo đã cũ khi SL/TP/qty/mark đổi
    const positionFingerprint = [
        tradeKeyOf(account, symbol, side),
        metrics.mark,
        metrics.entry,
        metrics.qty,
        metrics.unrealized,
        metrics.sl,
        metrics.tp,
        metrics.liquidation,
    ].join("|");
    report.meta = { ...(report.meta || {}), positionFingerprint };

    const saved = await saveReport(actor, {
        scope: "position",
        tradeKey: tradeKeyOf(account, symbol, side),
        account,
        symbol,
        side,
        snapshotId,
        asOf,
        report,
    });

    return {
        report,
        saved: { id: saved.id, createdAt: saved.createdAt },
        snapshot: {
            snapshotId,
            asOf,
            metrics,
            market: market.error ? { error: market.error, asOf: market.asOf } : {
                multiTf: market.multiTf,
                alignment: market.alignment,
                atr14: market.atr14,
                levels: market.levels,
                candidateLevels: market.candidateLevels,
                tf15: market.tf15,
                tf1h: market.tf1h,
                tf4h: market.tf4h,
                btc1h: market.btc1h
                    ? {
                        structure: market.btc1h.structure,
                        trendVsEma: market.btc1h.trendVsEma,
                        rsi14: market.btc1h.rsi14,
                        atr14: market.btc1h.atr14,
                    }
                    : null,
                note: market.note,
            },
            technical: technicalBrief.cards,
            marketContext,
            scenarios,
            riskProfileConfigured: riskConfigured,
            missingData,
            positionFingerprint,
        },
        configured: require("../dashboard-brief").aiSettings().configured,
    };
}

/**
 * Phân tích tài khoản — lấy positions từ loadPositions fast.
 */
async function runAccountDecision(actor, body = {}, deps = {}) {
    const username = assertBotAccess(
        actor,
        body.username || body.account,
        PERMISSIONS.POSITIONS_VIEW
    );
    if (body.ai !== false) checkQuota(actor, `${username}|account`);

    const { profile, configured: riskConfigured } = await loadRisk(actor);

    let wallet = null;
    try {
        const bal = await getAccountBalance(actor, { account: username });
        wallet = {
            equity: bal.balance,
            walletBalance: bal.balance,
            available: bal.available,
            availableBalance: bal.available,
            stale: bal.stale,
            at: bal.at,
            source: bal.source,
        };
    } catch (error) {
        console.warn("[runAccountDecision] wallet", error.message || error);
    }

    const { loadPositions } = require("../positions");
    const { readExchangeBook, readExchangeBooks } = deps.live || require("../position-live");
    const { markOf } = require("../mark-prices");
    const pack = await loadPositions(actor, {
        account: username,
        mode: "fast",
        book: body.book || "",
    }, {
        snapshot: readExchangeBook,
        snapshots: readExchangeBooks,
        priceOf: markOf,
    });

    // loadPositions với account=username chỉ trả rows của bot đó
    const scoped = (pack.rows || []).filter((row) => {
        const amt = Math.abs(Number(row.size ?? row.exchangeQty ?? row.qty) || 0);
        return amt > 0 || row.book === "pending";
    });

    const accountMetrics = computeAccountMetrics({
        username,
        positions: scoped,
        wallet,
        riskProfile: riskConfigured ? profile : null,
    });
    if (!riskConfigured) {
        accountMetrics.missingData = [...new Set([...(accountMetrics.missingData || []), "risk_profile"])];
    }

    const { scenarios } = buildAccountScenarios(accountMetrics);
    const asOf = new Date().toISOString();
    const snapshotId = makeSnapshotId({
        scope: "account",
        account: username,
        asOf,
        formulaVersion: "decision-v1",
    });

    const snapshot = {
        scope: "account",
        account: username,
        accountMetrics,
        metrics: null,
        market: null,
        scenarios,
        riskProfile: riskConfigured ? profile : null,
        riskProfileConfigured: riskConfigured,
        missingData: accountMetrics.missingData || [],
        riskLevelHint: accountMetrics.riskLevelHint,
        snapshotId,
        asOf,
        formulaVersion: "decision-v1",
    };

    const report = await generateAiReport(snapshot, {
        fetchImpl: deps.fetchImpl,
        forceRules: body.ai === false,
    });

    const saved = await saveReport(actor, {
        scope: "account",
        account: username,
        snapshotId,
        asOf,
        report,
    });

    return {
        report,
        saved: { id: saved.id, createdAt: saved.createdAt },
        snapshot: {
            snapshotId,
            asOf,
            accountMetrics: {
                equity: accountMetrics.equity,
                available: accountMetrics.available,
                positionCount: accountMetrics.positionCount,
                grossNotional: accountMetrics.grossNotional,
                exposurePct: accountMetrics.exposurePct,
                missingSlCount: accountMetrics.missingSlCount,
                missingSl: accountMetrics.missingSl,
                concentration: accountMetrics.concentration?.slice(0, 8),
                topSymbol: accountMetrics.topSymbol,
                profileBreaches: accountMetrics.profileBreaches,
                riskLevelHint: accountMetrics.riskLevelHint,
                missingData: accountMetrics.missingData,
            },
            scenarios,
            riskProfileConfigured: riskConfigured,
            missingData: accountMetrics.missingData,
        },
        configured: require("../dashboard-brief").aiSettings().configured,
    };
}

module.exports = {
    runPositionDecision,
    runAccountDecision,
    listReports,
    latestAccountReport,
    tradeKeyOf,
    QUOTA_MS,
};
