/**
 * Top-N nhóm PnL cho bar ngang.
 * mode: abs | gain | loss
 * Không gọi kết quả abs là “top hiệu suất”.
 */

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rankGroups(rows, {
  nameKey = "name",
  profitKey = "profit",
  countKey = "count",
  winRateKey = "winRate",
  limit = 10,
  mode = "abs",
} = {}) {
  const list = (rows || []).map((row, index) => {
    const name = row[nameKey] ?? row.signal ?? row.env ?? row.symbol ?? row.username ?? `#${index + 1}`;
    const profit = finite(row[profitKey]);
    return {
      id: String(name),
      name: String(name),
      profit,
      count: Number(row[countKey]) || 0,
      winRate: finite(row[winRateKey]),
      wins: Number(row.wins) || 0,
      losses: Number(row.losses) || 0,
      raw: row,
    };
  }).filter((row) => row.profit != null);

  let ranked;
  if (mode === "gain") {
    ranked = list.filter((row) => row.profit > 0).sort((a, b) => b.profit - a.profit || b.count - a.count);
  } else if (mode === "loss") {
    ranked = list.filter((row) => row.profit < 0).sort((a, b) => a.profit - b.profit || b.count - a.count);
  } else {
    ranked = [...list].sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit) || b.count - a.count);
  }

  const shown = ranked.slice(0, Math.max(1, limit));
  const rest = ranked.slice(shown.length);
  const restGain = rest.filter((row) => row.profit > 0).reduce((sum, row) => sum + row.profit, 0);
  const restLoss = rest.filter((row) => row.profit < 0).reduce((sum, row) => sum + row.profit, 0);
  const totalProfit = list.reduce((sum, row) => sum + (row.profit || 0), 0);

  return {
    shown,
    totalGroups: list.length,
    shownCount: shown.length,
    restCount: rest.length,
    restGain,
    restLoss,
    totalProfit,
    maxAbs: Math.max(1, ...shown.map((row) => Math.abs(row.profit || 0))),
  };
}

export function summarizeTop(rank) {
  if (!rank?.shown?.length) return "Không có nhóm có PnL để xếp.";
  const top = rank.shown[0];
  const sign = top.profit > 0 ? "+" : "";
  const rest = rank.restCount
    ? ` · còn ${rank.restCount} nhóm: lãi ${signMoney(rank.restGain)}, lỗ ${signMoney(rank.restLoss)}`
    : "";
  return `${top.name} đóng góp ${signMoney(top.profit)} từ ${top.count} lệnh · top ${rank.shownCount}/${rank.totalGroups}${rest}`;
}

function signMoney(value) {
  const n = Number(value) || 0;
  const text = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n > 0) return `+${text} USDT`;
  if (n < 0) return `−${text} USDT`;
  return `${text} USDT`;
}
