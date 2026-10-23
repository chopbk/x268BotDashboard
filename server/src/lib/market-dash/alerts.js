/**
 * Telegram alerts — score ≥ ngưỡng, setup mới, đổi regime.
 * Cooldown 1 alert / coin / setup / 4h.
 */
const MarketDashAlertLog = require("../../models/market-dash-alert-log");
const { config } = require("./config");
const { regimeLabelVi } = require("./analyzer/regime");

const memoryCooldown = new Map();

function cooldownKey(kind, symbol, setup, timeframe) {
    return [kind, symbol || "-", setup || "-", timeframe || "-"].join("|");
}

async function wasRecentlySent(key, cooldownMs = config.alertCooldownMs) {
    const mem = memoryCooldown.get(key);
    if (mem && Date.now() - mem < cooldownMs) return true;
    try {
        const since = new Date(Date.now() - cooldownMs);
        const row = await MarketDashAlertLog.findOne({
            cooldownKey: key,
            sentAt: { $gte: since },
            ok: true,
        })
            .sort({ sentAt: -1 })
            .lean();
        if (row) {
            memoryCooldown.set(key, new Date(row.sentAt).getTime());
            return true;
        }
    } catch (error) {
        console.warn("[MARKET_DASH] alert cooldown read", error.message || error);
    }
    return false;
}

async function sendTelegram(text) {
    if (!config.telegramBotToken || !config.telegramChatId) {
        return { ok: false, skipped: true, reason: "no_telegram_config" };
    }
    if (config.telegramDryRun) {
        console.log("[MARKET_DASH] telegram dry-run", text.slice(0, 200));
        return { ok: true, dryRun: true };
    }
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: config.telegramChatId,
                text,
                disable_web_page_preview: true,
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
            return { ok: false, error: body.description || `http ${res.status}` };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: String(error.message || error) };
    }
}

async function logAndSend({ kind, symbol, setup, timeframe, text, payload }) {
    const key = cooldownKey(kind, symbol, setup, timeframe);
    if (await wasRecentlySent(key)) {
        return { ok: false, skipped: true, reason: "cooldown" };
    }
    const result = await sendTelegram(text);
    const dryRun = Boolean(result.dryRun || config.telegramDryRun);
    try {
        await MarketDashAlertLog.create({
            kind,
            symbol: symbol || null,
            setup: setup || null,
            timeframe: timeframe || null,
            payload: payload || { text },
            cooldownKey: key,
            sentAt: new Date(),
            dryRun,
            ok: Boolean(result.ok),
            error: result.error || result.reason || null,
        });
    } catch (error) {
        console.warn("[MARKET_DASH] alert log", error.message || error);
    }
    if (result.ok) memoryCooldown.set(key, Date.now());
    return result;
}

async function maybeAlertSignal(row) {
    if (!row) return null;
    const score = row.score;
    const should =
        score != null && score >= config.alertScoreThreshold;
    // Always alert on new setup; also emphasize high score
    const text = [
        `📡 Setup mới: ${row.symbol} ${row.setup} ${row.timeframe}`,
        `Hướng: ${String(row.direction).toUpperCase()} · Score ${row.scoreRaw} → ${row.score}${row.regimeBtc1d ? ` (regime ${row.regimeBtc1d})` : ""}`,
        `Entry ${row.entry} · SL ${row.stopLoss} · TP ${row.takeProfit} · R:R ${row.rr ?? "—"}`,
        should ? `⭐ Đạt ngưỡng score ≥ ${config.alertScoreThreshold}` : "",
        `UTC+7 · gợi ý tham khảo, không phải khuyến nghị đầu tư`,
    ]
        .filter(Boolean)
        .join("\n");

    return logAndSend({
        kind: should ? "score_setup" : "setup_new",
        symbol: row.symbol,
        setup: row.setup,
        timeframe: row.timeframe,
        text,
        payload: {
            score: row.score,
            scoreRaw: row.scoreRaw,
            direction: row.direction,
            entry: row.entry,
            stopLoss: row.stopLoss,
            takeProfit: row.takeProfit,
        },
    });
}

async function maybeAlertRegime(prev, next, pulse) {
    if (!prev || !next || prev === next) return null;
    const text = [
        `🌤 Đổi regime BTC 1D: ${regimeLabelVi(prev)} → ${regimeLabelVi(next)}`,
        pulse?.score != null ? `Pulse: ${pulse.score} (${pulse.label})` : null,
        ...(pulse?.brief || []).slice(0, 2),
        `UTC+7 · gợi ý tham khảo, không phải khuyến nghị đầu tư`,
    ]
        .filter(Boolean)
        .join("\n");
    return logAndSend({
        kind: "regime_change",
        symbol: "BTCUSDT",
        setup: "regime",
        timeframe: "1d",
        text,
        payload: { prev, next, pulseScore: pulse?.score },
    });
}

function resetAlertMemoryForTests() {
    memoryCooldown.clear();
}

module.exports = {
    maybeAlertSignal,
    maybeAlertRegime,
    sendTelegram,
    wasRecentlySent,
    cooldownKey,
    logAndSend,
    resetAlertMemoryForTests,
};
