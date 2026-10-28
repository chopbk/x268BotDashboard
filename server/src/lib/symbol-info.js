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

/**
 * Batch lookup tickSize/stepSize từ futures_symbols (ưu tiên exchange binance).
 * @param {string[]} symbols
 * @returns {Promise<Map<string, ReturnType<typeof toSymbolInfo>|null>>}
 */
async function findSymbolInfoMap(symbols) {
    const list = [
        ...new Set(
            (symbols || [])
                .map((s) => String(s || "").trim().toUpperCase())
                .filter((s) => /^[A-Z0-9]{4,25}$/.test(s))
        ),
    ];
    const out = new Map();
    if (!list.length) return out;

    const candidatesBySymbol = new Map();
    const allNames = new Set();
    for (const sym of list) {
        const cands = symbolCandidates(sym);
        candidatesBySymbol.set(sym, cands);
        for (const name of cands) allNames.add(name);
    }

    let rows = [];
    try {
        rows = await FuturesSymbol.find({ symbol: { $in: [...allNames] } })
            .select("symbol exchange tickSize stepSize")
            .lean();
    } catch (error) {
        console.warn("[findSymbolInfoMap]", error.message || error);
        for (const sym of list) out.set(sym, null);
        return out;
    }

    const byName = new Map();
    for (const row of rows) {
        const key = String(row.symbol || "").toUpperCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(row);
    }

    for (const sym of list) {
        const cands = candidatesBySymbol.get(sym) || [];
        let pool = [];
        for (const name of cands) {
            pool = byName.get(name) || [];
            if (pool.length) break;
        }
        if (!pool.length) {
            out.set(sym, null);
            continue;
        }
        const exact = pool.filter((row) => row.symbol === cands[0]);
        const chosenPool = exact.length ? exact : pool;
        const row = chosenPool.find((item) => item.exchange === "binance") || chosenPool[0];
        out.set(sym, toSymbolInfo(row));
    }
    return out;
}

/** Floor qty xuống bội stepSize (Binance LOT_SIZE). */
function floorToStep(value, step) {
    const n = Number(value);
    const size = Number(step);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!Number.isFinite(size) || size <= 0) {
        return String(Number(n.toPrecision(12)));
    }
    const decimals = decimalsFromStep(size);
    const floored = Math.floor((n / size) + 1e-12) * size;
    if (!(floored > 0)) return null;
    if (decimals == null) return String(Number(floored.toPrecision(12)));
    return floored.toFixed(decimals);
}

/** Round price về bội tickSize (Binance PRICE_FILTER). */
function roundToTick(value, tick) {
    const n = Number(value);
    const size = Number(tick);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!Number.isFinite(size) || size <= 0) {
        return String(Number(n.toPrecision(12)));
    }
    const decimals = decimalsFromStep(size);
    const rounded = Math.round(n / size) * size;
    if (!(rounded > 0)) return null;
    if (decimals == null) return String(Number(rounded.toPrecision(12)));
    return rounded.toFixed(decimals);
}

module.exports = {
    decimalsFromStep,
    findSymbolInfo,
    findSymbolInfoMap,
    toSymbolInfo,
    floorToStep,
    roundToTick,
    symbolCandidates,
};
