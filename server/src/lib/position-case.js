/**
 * Chi tiết một “case” position: account + symbol + side.
 * Gom Mongo monitors, Redis book, heartbeat và cảnh báo lệch.
 */
const { PERMISSIONS, canAccessResource } = require("../auth/access-control");
const { httpError } = require("./http");
const {
    visibleBots,
    monitorOwner,
    heartbeatFresh,
    monitorDetail,
    buildPositionView,
    isClosedDoc,
    symbolKeys,
    preferExactSymbol,
    dedupeMonitors,
} = require("./positions");
const { readExchangeBook, reconcile, cached } = require("./position-live");

const QTY_EPS = 1e-8;
const STALE_MS = 90_000;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function absNum(value) {
    const n = num(value);
    return n == null ? 0 : Math.abs(n);
}

function ageMs(value, now) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? now - time : null;
}

function logEvent(row) {
    if (!row || typeof row !== "object") return null;
    return {
        at: row.at || row.time || null,
        phase: row.phase || null,
        event: row.event || row.type || null,
        message: row.message || row.msg || null,
    };
}

function classifyTimeline(event) {
    const text = `${event?.event || ""} ${event?.phase || ""} ${event?.message || ""}`.toUpperCase();
    if (/DCA|ADD|AVERAGE|PYRAMID/.test(text)) return "dca";
    if (/PARTIAL|REDUCE|CLOSE.*PART|TAKE.*PARTIAL/.test(text)) return "partial_close";
    if (/MOVE.*SL|SL.*MOVE|TRAIL|HSL|SP\b|DỜI|DOI SL/.test(text)) return "sl_move";
    if (/STOP|SL\b|TAKE_PROFIT|TP\b|TRAILING/.test(text)) return "protective";
    if (/OPEN|ENTRY|FILLED/.test(text)) return "open";
    if (/CLOSE|END|GONE/.test(text)) return "close";
    return "other";
}

function extractFills(fills) {
    return (Array.isArray(fills) ? fills : []).slice(-80).map((fill) => ({
        at: fill.time || fill.at || fill.T || null,
        price: num(fill.price || fill.avgPrice || fill.p),
        qty: absNum(fill.qty || fill.quantity || fill.q || fill.origQty),
        side: fill.side || null,
        realizedPnl: num(fill.realizedPnl ?? fill.rp),
        commission: num(fill.commission ?? fill.n),
        kind: /DCA|ADD/i.test(String(fill.reason || fill.type || "")) ? "dca" : "fill",
    }));
}

function monitorStatsView(stats) {
    const s = stats && typeof stats === "object" ? stats : {};
    const maxRoe = num(s.maxRoe ?? s.mfe ?? s.MFE);
    const minRoe = num(s.minRoe ?? s.mae ?? s.MAE);
    return {
        maxRoe,
        minRoe,
        mfe: maxRoe,
        mae: minRoe,
        maxProfit: num(s.maxProfit ?? s.maxPnl),
        maxDrawdown: num(s.maxDrawdown ?? s.minProfit ?? s.minPnl),
        slMoves: num(s.slMoves) || 0,
        hpMoves: num(s.hpMoves) || 0,
        realizedPnl: num(s.realizedPnl),
        commission: num(s.commission),
        funding: num(s.funding),
        raw: s,
    };
}

function weightedEntry(parts) {
    let numera = 0;
    let den = 0;
    for (const part of parts) {
        const qty = absNum(part.qty);
        const entry = num(part.entry);
        if (!(qty > 0) || entry == null || !(entry > 0)) continue;
        numera += entry * qty;
        den += qty;
    }
    return den > 0 ? numera / den : null;
}

function buildDrift({ exchange, redis, monitors, heartbeatOk, now }) {
    const warnings = [];
    const live = monitors.filter((m) => !m.paper && !m.pending && !m.closed && absNum(m.ownQty) > QTY_EPS);
    const exchangeQty = absNum(exchange?.qty);
    const ownSum = live.reduce((sum, m) => sum + absNum(m.ownQty), 0);
    const leftover = Math.max(0, exchangeQty - ownSum);

    // Lệch thật sự: Mongo mở vs sàn flat / qty config > sàn
    if (exchange && exchangeQty <= QTY_EPS && live.length) {
        warnings.push({ code: "mongo_open_exchange_flat", level: "error", message: "Mongo còn monitor mở nhưng sàn đã flat" });
    }
    if (ownSum > exchangeQty + QTY_EPS && exchangeQty > 0) {
        warnings.push({ code: "own_gt_exchange", level: "error", message: "Tổng qty config lớn hơn qty sàn" });
    }
    // Leftover có monitor: volume sàn không thuộc config nào
    if (leftover > QTY_EPS && live.length > 0) {
        warnings.push({ code: "leftover_qty", level: "warn", message: `Leftover trên sàn ≈ ${leftover} (sàn − tổng qty config)` });
    }
    // Không monitor: chỉ ghi chú, không coi lỗi (vị thế tay / NOTPSL)
    if (exchangeQty > QTY_EPS && !live.length) {
        warnings.push({ code: "exchange_open_no_monitor", level: "info", message: "Vị thế sàn không gắn monitor live" });
    }
    for (const m of live) {
        const snap = absNum(m.exchangeSnapshotQty);
        if (exchangeQty > QTY_EPS && snap > 0 && Math.abs(snap - exchangeQty) > Math.max(QTY_EPS, exchangeQty * 0.02)) {
            warnings.push({
                code: "monitor_snapshot_stale",
                level: "warn",
                message: `${m.env}: snapshot qty monitor (${snap}) lệch Redis/sàn (${exchangeQty})`,
                env: m.env,
            });
        }
        if (!m.watching && heartbeatOk === false) {
            warnings.push({
                code: "runtime_no_heartbeat",
                level: "warn",
                message: `${m.env}: không có heartbeat monitor gần đây`,
                env: m.env,
            });
        }
    }
    const redisAge = ageMs(redis?.reconciledAt || redis?.at, now);
    if (redisAge != null && redisAge > STALE_MS) {
        warnings.push({ code: "redis_stale", level: "info", message: `Redis sổ sàn cũ ~${Math.round(redisAge / 1000)}s — bấm Reconcile nếu cần` });
    }
    if (!redis && exchange) {
        warnings.push({ code: "redis_missing", level: "warn", message: "Không đọc được Redis book; đang dựa cache/process" });
    }
    if (redis?.stale === true || redis?.status === "stale") {
        warnings.push({ code: "book_marked_stale", level: "info", message: "Sổ đánh dấu stale" });
    }
    return { warnings, leftover, ownSum, exchangeQty };
}

async function loadPositionCase(actor, query = {}, deps = {}) {
    const account = String(query.account || "").trim();
    const symbol = String(query.symbol || "").trim().toUpperCase();
    const side = String(query.side || "").trim().toUpperCase();
    const audience = query.audience === "all" ? "all" : "mine";
    if (!account || !symbol || (side !== "LONG" && side !== "SHORT")) {
        throw httpError(400, "Cần account, symbol và side LONG|SHORT");
    }

    const UserAccount = deps.UserAccount || require("../models/user-account");
    const Monitor = deps.Monitor || require("../models/monitor-position");
    const Heartbeat = deps.Heartbeat || require("../models/process-heartbeat");
    const readBook = deps.readExchangeBook || readExchangeBook;
    const cachedBook = deps.cached || cached;

    const bots = await visibleBots(actor, UserAccount, audience);
    const bot = bots.find((row) => row.username === account);
    if (!bot) throw httpError(403, "Không có quyền với tài khoản này");
    if (!canAccessResource(actor, PERMISSIONS.POSITIONS_VIEW, bot)) {
        throw httpError(403, "Không có quyền xem position");
    }

    const now = Date.now();
    const beats = await Heartbeat.find({ "flags.monitor": true }).select("at flags").lean();
    const hbOk = heartbeatFresh(beats, now);
    const envOwners = new Map();
    for (const row of bots) {
        for (const env of row.accounts || []) envOwners.set(env, row.username);
    }

    const symbolQuery = symbolKeys(symbol);
    const docs = await Monitor.find({
        symbol: symbolQuery.length > 1 ? { $in: symbolQuery } : symbol,
        side,
        closed: { $ne: true },
        isClosed: { $ne: true },
        $or: [{ futuresClientName: account }, { env: { $in: bot.accounts || [] } }, { env: account }],
    }).lean();

    // Đúng owner + ưu tiên exact symbol sàn (ETHUSDT) trước base (ETH) — tránh zombie lệch format.
    const ownedDocs = preferExactSymbol(
        dedupeMonitors(
            (docs || []).filter((doc) => monitorOwner(doc, envOwners) === account && !isClosedDoc(doc)),
            (doc) => {
                const env = doc.env || "";
                const sym = String(doc.symbol || "").toUpperCase();
                const signal = doc.signal || doc.typeSignal || doc.type || "";
                return `${env}|${sym}|${side}|${signal}`;
            }
        ),
        symbol
    );

    let book = await readBook(account);
    if (!book) book = cachedBook(account);

    const exchangePos = (Array.isArray(book?.positions) ? book.positions : []).find((row) => {
        const mode = String(row.positionSide || "BOTH").toUpperCase();
        const amt = absNum(row.positionAmt);
        if (amt <= QTY_EPS) return false;
        if (String(row.symbol || "").toUpperCase() !== symbol) return false;
        if (mode === "LONG" || mode === "SHORT") return mode === side;
        return (side === "LONG" && Number(row.positionAmt) > 0) || (side === "SHORT" && Number(row.positionAmt) < 0);
    });

    const parents = buildPositionView({
        account,
        monitors: ownedDocs,
        exchangePositions: exchangePos ? [exchangePos] : (book?.positions || []),
        openOrders: book?.openOrders || [],
        algoOrders: book?.algoOrders || [],
        heartbeatFresh: hbOk,
        now,
        connection: book?.stale || book?.status === "stale" ? "stale" : "live",
        exchangeLoaded: Boolean(book),
        income: book?.income || [],
        positionHistory: book?.positionHistory || [],
        trades: book?.trades || [],
    }).filter((row) => row.symbol === symbol && row.side === side);

    const parent = parents.find((row) => row.book === "live") || parents[0] || null;

    const monitors = ownedDocs.map((doc) => {
        const detail = monitorDetail(doc, hbOk, now);
        const timeline = [...(detail.openLogs || []), ...(detail.logs || [])]
            .map(logEvent)
            .filter(Boolean)
            .map((item) => ({ ...item, kind: classifyTimeline(item) }))
            .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
        return {
            ...detail,
            statsView: monitorStatsView(detail.stats),
            fillHistory: extractFills(detail.fills),
            timeline,
            events: {
                dca: timeline.filter((item) => item.kind === "dca").length,
                partialClose: timeline.filter((item) => item.kind === "partial_close").length,
                slMove: timeline.filter((item) => item.kind === "sl_move").length + (Number(detail.stats?.slMoves) || 0),
            },
        };
    });

    // Chỉ monitor đang mở + còn qty config; dedupe lần nữa theo env (view đã public).
    const liveMonitors = dedupeMonitors(
        monitors.filter((m) => !m.paper && !m.pending && !m.closed && absNum(m.ownQty) > QTY_EPS),
        (m) => `${m.env || ""}|${symbol}|${side}|${m.signal || m.type || ""}`
    );
    const exchange = exchangePos
        ? {
            qty: absNum(exchangePos.positionAmt),
            entry: num(exchangePos.entryPrice),
            mark: num(exchangePos.markPrice),
            unrealized: num(exchangePos.unRealizedProfit),
            leverage: num(exchangePos.leverage),
            liquidation: num(exchangePos.liquidationPrice),
            positionSide: exchangePos.positionSide || "BOTH",
        }
        : parent?.exchangeQty != null
            ? {
                qty: absNum(parent.exchangeQty),
                entry: num(parent.entry),
                mark: num(parent.mark),
                unrealized: num(parent.unrealized),
                leverage: num(parent.leverage),
                liquidation: num(parent.liquidation),
                positionSide: parent.mode,
            }
            : null;

    const ownership = liveMonitors.map((m) => ({
        id: m.id,
        env: m.env,
        signal: m.signal || m.type,
        ownQty: m.ownQty,
        entry: m.entry,
        share: exchange?.qty > 0 ? m.ownQty / exchange.qty : null,
        notpsl: m.notpsl,
        watching: m.watching,
        tp: m.tp,
        sl: m.sl,
        trailing: m.trailing,
        expectedOrders: m.expectedOrders,
    }));

    const redis = book
        ? {
            at: book.at || null,
            reconciledAt: book.reconciledAt || null,
            source: book.source || null,
            status: book.status || null,
            stale: book.stale === true,
            version: book.version == null ? null : Number(book.version),
            ageMs: ageMs(book.reconciledAt || book.at, now),
        }
        : null;

    const drift = buildDrift({ exchange, redis, monitors: liveMonitors, heartbeatOk: hbOk, now });
    const avgEntryConfigs = weightedEntry(ownership.map((row) => ({ qty: row.ownQty, entry: row.entry })));

    let orderHistory = [];
    try {
        const { loadOrderHistory } = require("./orders");
        const from = new Date(now);
        from.setDate(from.getDate() - 7);
        const hist = await (deps.loadOrderHistory || loadOrderHistory)(actor, {
            account,
            symbol,
            positionSide: side,
            audience,
            from: from.toISOString(),
            limit: 80,
        });
        orderHistory = hist?.orders || [];
    } catch (error) {
        console.error("[loadPositionCase] orderHistory", error.message);
    }

    return {
        account,
        symbol,
        side,
        key: parent?.key || `${account}|${symbol}|${side}|BOTH`,
        exchange,
        redis,
        heartbeat: { ok: hbOk === true, staleAfterMs: STALE_MS },
        ownership,
        ownershipSummary: {
            configCount: ownership.length,
            ownQtySum: drift.ownSum,
            exchangeQty: drift.exchangeQty,
            leftover: drift.leftover,
            sibling: ownership.length > 1,
            notpslCount: ownership.filter((row) => row.notpsl).length,
            avgEntryConfigs,
            exchangeEntry: exchange?.entry ?? null,
        },
        protective: {
            exchangeTp: parent?.exchangeTp ?? null,
            exchangeSl: parent?.exchangeSl ?? null,
            exchangeTrailingCallback: parent?.exchangeTrailingCallback ?? null,
            exchangeOrders: parent?.exchangeOrders || [],
            algoOrders: parent?.algoOrders || [],
        },
        monitors: liveMonitors,
        orderHistory,
        warnings: drift.warnings,
        recorded: parent?.recorded || null,
        updatedAt: new Date(now).toISOString(),
    };
}

async function reconcilePositionCase(actor, body = {}, deps = {}) {
    const account = String(body.account || "").trim();
    const symbol = String(body.symbol || "").trim().toUpperCase();
    const side = String(body.side || "").trim().toUpperCase();
    if (!account) throw httpError(400, "Thiếu account");

    const UserAccount = deps.UserAccount || require("../models/user-account");
    const bots = await visibleBots(actor, UserAccount, body.audience === "all" ? "all" : "mine");
    const bot = bots.find((row) => row.username === account);
    if (!bot || !canAccessResource(actor, PERMISSIONS.POSITIONS_VIEW, bot)) {
        throw httpError(403, "Không có quyền reconcile tài khoản này");
    }

    const run = deps.reconcile || reconcile;
    // An toàn: chỉ force REST/MQTT refresh sổ, không cancel order / đóng vị thế.
    await run(account, { force: true, details: true, viaMqtt: false });
    return loadPositionCase(actor, { account, symbol, side, audience: body.audience }, deps);
}

module.exports = {
    loadPositionCase,
    reconcilePositionCase,
    classifyTimeline,
    monitorStatsView,
    weightedEntry,
    buildDrift,
};
