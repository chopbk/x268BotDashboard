const { smartMoneyFetch } = require("../http");
const { finite } = require("../formulas");

let cache = { at: 0, bySymbol: new Map() };
const TTL_MS = 60 * 60 * 1000;

function isCryptoUsdtPerp(row) {
    if (!row || row.status !== "TRADING") return false;
    if (row.quoteAsset !== "USDT") return false;
    if (row.contractType && row.contractType !== "PERPETUAL") return false;
    if (String(row.contractType || "").toUpperCase().includes("TRADIFI")) return false;
    if (String(row.underlyingType || "").toUpperCase() === "EQUITY") return false;
    if (String(row.underlyingType || "").toUpperCase() === "COMMODITY") return false;
    if (String(row.underlyingType || "").toUpperCase() === "INDEX") return false;
    // Chỉ coin/crypto mặc định; thiếu underlyingType vẫn cho qua nếu PERPETUAL USDT.
    const ut = String(row.underlyingType || "").toUpperCase();
    if (ut && ut !== "COIN" && ut !== "CRYPTOCURRENCY" && ut !== "CRYPTO") {
        // Một số symbol chỉ có underlyingType khác — từ chối TradFi đã lọc ở trên.
        if (["STOCK", "FOREX", "FIAT"].includes(ut)) return false;
    }
    return true;
}

async function loadExchangeInfo(force = false) {
    if (!force && cache.bySymbol.size && Date.now() - cache.at < TTL_MS) return cache.bySymbol;
    const { body } = await smartMoneyFetch("fapi", "/fapi/v1/exchangeInfo");
    const map = new Map();
    for (const s of body?.symbols || []) {
        if (!s?.symbol) continue;
        map.set(s.symbol, {
            symbol: s.symbol,
            status: s.status,
            contractType: s.contractType || null,
            underlyingType: s.underlyingType || null,
            quoteAsset: s.quoteAsset || null,
            baseAsset: s.baseAsset || null,
            cryptoUsdtPerp: isCryptoUsdtPerp(s),
            fundingIntervalHours: finite(s.fundingIntervalHours) ?? null,
        });
    }
    cache = { at: Date.now(), bySymbol: map };
    return map;
}

function resetExchangeInfoCacheForTests() {
    cache = { at: 0, bySymbol: new Map() };
}

module.exports = {
    loadExchangeInfo,
    isCryptoUsdtPerp,
    resetExchangeInfoCacheForTests,
};
