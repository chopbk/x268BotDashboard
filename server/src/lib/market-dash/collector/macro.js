/**
 * CoinGecko /global + alternative.me Fear & Greed.
 */
const { saveMacro, getMacro } = require("../store");

const CG_URL = "https://api.coingecko.com/api/v3/global";
const FNG_URL = "https://api.alternative.me/fng/?limit=1";

async function fetchJson(url, timeoutMs = 12_000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

async function collectMacro() {
    const updatedAt = new Date().toISOString();
    const out = {
        updatedAt,
        btcDominance: null,
        ethDominance: null,
        totalMarketCap: null,
        totalVolume: null,
        fearGreed: null,
        fearGreedLabel: null,
        stale: false,
        errors: [],
    };

    try {
        const body = await fetchJson(CG_URL);
        const d = body?.data || {};
        out.btcDominance = Number.isFinite(Number(d.market_cap_percentage?.btc))
            ? Number(d.market_cap_percentage.btc)
            : null;
        out.ethDominance = Number.isFinite(Number(d.market_cap_percentage?.eth))
            ? Number(d.market_cap_percentage.eth)
            : null;
        out.totalMarketCap = Number.isFinite(Number(d.total_market_cap?.usd))
            ? Number(d.total_market_cap.usd)
            : null;
        out.totalVolume = Number.isFinite(Number(d.total_volume?.usd))
            ? Number(d.total_volume.usd)
            : null;
    } catch (error) {
        out.errors.push(`coingecko:${error.message || error}`);
        console.warn("[MARKET_DASH] macro CG", error.message || error);
    }

    try {
        const body = await fetchJson(FNG_URL);
        const row = body?.data?.[0];
        if (row) {
            out.fearGreed = Number.isFinite(Number(row.value)) ? Number(row.value) : null;
            out.fearGreedLabel = row.value_classification || null;
        }
    } catch (error) {
        out.errors.push(`fng:${error.message || error}`);
        console.warn("[MARKET_DASH] macro F&G", error.message || error);
    }

    const prev = await getMacro();
    if (out.btcDominance == null && prev?.btcDominance != null) {
        out.btcDominance = prev.btcDominance;
        out.ethDominance = prev.ethDominance ?? out.ethDominance;
        out.totalMarketCap = prev.totalMarketCap ?? out.totalMarketCap;
        out.stale = true;
    }
    if (out.fearGreed == null && prev?.fearGreed != null) {
        out.fearGreed = prev.fearGreed;
        out.fearGreedLabel = prev.fearGreedLabel;
        out.stale = true;
    }

    await saveMacro(out);
    return out;
}

module.exports = { collectMacro };
