/**
 * P0 template recap — max 4 facts with evidence; no causal claims.
 */
const crypto = require("crypto");

function fmtPct(n, digits = 2) {
    if (!Number.isFinite(n)) return null;
    return `${n.toFixed(digits)}%`;
}

function fmtBp(n) {
    if (!Number.isFinite(n)) return null;
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)} bp`;
}

/**
 * @returns {{ title: string, snapshotId: string, publishedAt: string, facts: object[], coverage: object }}
 */
function buildContextBrief({ metrics = {}, cryptoRefs = {}, nextEvent = null, serverNow = new Date() } = {}) {
    const facts = [];
    const publishedAt = serverNow.toISOString();

    // 1) Crypto context
    const btcD = cryptoRefs?.btcDominance?.value ?? cryptoRefs?.btcDominance;
    const fng = cryptoRefs?.fearGreed?.value ?? cryptoRefs?.fearGreed;
    const btcPrice = cryptoRefs?.btc?.price;
    if (Number.isFinite(Number(btcD)) || Number.isFinite(Number(fng)) || Number.isFinite(Number(btcPrice))) {
        const parts = [];
        if (Number.isFinite(Number(btcPrice))) parts.push(`BTC ${Number(btcPrice).toLocaleString("en-US")}`);
        if (Number.isFinite(Number(btcD))) parts.push(`BTC.D ${fmtPct(Number(btcD), 1)}`);
        if (Number.isFinite(Number(fng))) {
            const label = cryptoRefs?.fearGreed?.displayValue || cryptoRefs?.fearGreedLabel;
            parts.push(`F&G ${Number(fng)}${label ? ` (${label})` : ""}`);
        }
        facts.push({
            id: "crypto_context",
            text: parts.join(" · "),
            asOf: cryptoRefs?.btcDominance?.observedAt || cryptoRefs?.fearGreed?.observedAt || null,
            quality: cryptoRefs?.btcDominance?.quality || cryptoRefs?.fearGreed?.quality || "fresh",
            evidenceRefs: [
                cryptoRefs?.btcDominance?.id || "crypto.btc_dominance",
                cryptoRefs?.fearGreed?.id || "crypto.fear_greed",
            ].filter(Boolean),
            drillDown: { econView: "context", focus: "crypto" },
        });
    }

    // 2) Yield / VIX
    const y10 = metrics["us.yield.10y"];
    const spread = metrics["us.yield.spread_10y_2y"];
    const vix = metrics["us.vix.close"];
    const yieldParts = [];
    if (y10?.value != null) {
        let t = `US 10Y ${fmtPct(y10.value)}`;
        if (y10.deltaBp != null) t += ` (${fmtBp(y10.deltaBp)})`;
        yieldParts.push(t);
    }
    if (spread?.value != null) {
        const inv = spread.value < 0 ? " — đường cong đảo ngược ở cặp 10Y−2Y" : "";
        yieldParts.push(`10Y−2Y ${fmtBp(spread.value)}${inv}`);
    }
    if (vix?.value != null) yieldParts.push(`VIX close ${vix.value}`);
    if (yieldParts.length) {
        facts.push({
            id: "us_yields_vix",
            text: yieldParts.join(" · "),
            asOf: y10?.observationDate || vix?.observationDate || null,
            quality: y10?.quality || vix?.quality || "missing",
            evidenceRefs: ["us.yield.10y", "us.yield.spread_10y_2y", "us.vix.close"].filter(
                (id) => metrics[id]?.value != null
            ),
            drillDown: { econView: "context", focus: "yields" },
        });
    }

    // 3) Next high-impact event
    if (nextEvent?.title && nextEvent?.scheduledAt) {
        facts.push({
            id: "next_event",
            text: `Sự kiện kế tiếp: ${nextEvent.title} (${nextEvent.currency || nextEvent.country || "?"})`,
            asOf: nextEvent.scheduledAt,
            quality: nextEvent.coverage === "unavailable" ? "missing" : "fresh",
            evidenceRefs: [nextEvent.eventId],
            drillDown: { econView: "calendar", event: nextEvent.eventId },
        });
    }

    // 4) Latest release status — only if we have a due/released event summary
    if (nextEvent?.status === "due") {
        facts.push({
            id: "release_status",
            text: `Đến giờ công bố — chờ actual (chưa có nguồn actual đã xác minh)`,
            asOf: nextEvent.scheduledAt,
            quality: "warming",
            evidenceRefs: [nextEvent.eventId],
            drillDown: { econView: "calendar", event: nextEvent.eventId },
        });
    }

    const trimmed = facts.slice(0, 4);
    const inputKey = trimmed.map((f) => `${f.id}:${f.asOf}:${f.text}`).join("|");
    const snapshotId = `brief_${crypto.createHash("sha256").update(inputKey || "empty").digest("hex").slice(0, 16)}`;

    return {
        title: "Bối cảnh kinh tế",
        snapshotId,
        publishedAt,
        formulaVersion: "economy-context-v1",
        facts: trimmed,
        coverage: {
            status: trimmed.length ? (trimmed.length < 2 ? "partial" : "complete") : "unavailable",
            reasons: trimmed.length ? [] : ["insufficient_metrics_for_brief"],
        },
    };
}

module.exports = { buildContextBrief };
