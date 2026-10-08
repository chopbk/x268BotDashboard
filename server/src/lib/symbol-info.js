const FuturesSymbol = require("../models/futures-symbol");

function decimalsFromStep(step) {
    const size = Number(step);
    if (!Number.isFinite(size) || size <= 0) return null;
    let scaled = size;
    let decimals = 0;
    while (decimals < 12 && Math.abs(scaled - Math.round(scaled)) > 1e-8) {
        scaled *= 10;
        decimals += 1;
    }
    return decimals;
}

function symbolCandidates(symbol) {
    const name = String(symbol || "").trim().toUpperCase();
    if (!name) return [];
    const names = [name];
    if (name.endsWith("USDT") && !name.startsWith("1000")) names.push(`1000${name}`);
    else if (name.startsWith("1000") && name.endsWith("USDT")) names.push(name.slice(4));
    return names;
}

function toSymbolInfo(row) {
    if (!row) return null;
    return {
        symbol: row.symbol || "",
        exchange: row.exchange || "",
        tickSize: Number.isFinite(Number(row.tickSize)) ? Number(row.tickSize) : null,
        stepSize: Number.isFinite(Number(row.stepSize)) ? Number(row.stepSize) : null,
        priceDecimals: decimalsFromStep(row.tickSize),
        qtyDecimals: decimalsFromStep(row.stepSize),
    };
}

async function findSymbolInfo(symbol) {
    const names = symbolCandidates(symbol);
    if (!names.length) return null;
    const rows = await FuturesSymbol.find({ symbol: { $in: names } })
        .select("symbol exchange tickSize stepSize")
        .limit(12)
        .lean();
    const exact = rows.filter((row) => row.symbol === names[0]);
    const pool = exact.length ? exact : rows;
    if (!pool.length) return null;
    const row = pool.find((item) => item.exchange === "binance") || pool[0];
    return toSymbolInfo(row);
}

module.exports = { decimalsFromStep, findSymbolInfo, toSymbolInfo };
