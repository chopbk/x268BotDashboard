/**
 * Gộp series ngày UTC thành tuần/tháng khi kỳ >90 ngày.
 * Không bịa điểm; nhãn bucket rõ ràng. Selection ngày tắt khi đã bucket.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day) {
  const text = String(day || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Monday UTC of the week containing day. */
export function utcWeekStart(day) {
  const date = parseDay(day);
  if (!date) return null;
  const dow = date.getUTCDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  return new Date(date.getTime() + monOffset * DAY_MS).toISOString().slice(0, 10);
}

export function utcMonthKey(day) {
  return String(day || "").slice(0, 7);
}

/**
 * @param {Array} series — { day, profit, trades, wins, losses, cumulative? }
 * @param {"auto"|"day"|"week"|"month"} grain
 */
export function bucketSeries(series, grain = "auto") {
  const rows = (series || []).filter((row) => parseDay(row.day));
  if (!rows.length) {
    return { points: [], bucket: "day", selectable: true, label: "ngày" };
  }

  let mode = grain;
  if (mode === "auto") {
    if (rows.length <= 90) mode = "day";
    else if (rows.length <= 180) mode = "week";
    else mode = "month";
  }

  if (mode === "day") {
    return {
      points: rows.map((row) => ({ ...row, bucketKey: row.day, bucketLabel: row.day })),
      bucket: "day",
      selectable: true,
      label: "ngày",
    };
  }

  const groups = new Map();
  for (const row of rows) {
    const key = mode === "month" ? utcMonthKey(row.day) : utcWeekStart(row.day);
    if (!key) continue;
    const prev = groups.get(key) || {
      day: key,
      bucketKey: key,
      bucketLabel: mode === "month" ? key : `Tuần ${key}`,
      profit: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      days: 0,
    };
    prev.profit += Number(row.profit) || 0;
    prev.trades += Number(row.trades) || 0;
    prev.wins += Number(row.wins) || 0;
    prev.losses += Number(row.losses) || 0;
    prev.days += 1;
    groups.set(key, prev);
  }

  const points = [...groups.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row, index, all) => {
      const profit = Math.round((Number(row.profit) || 0) * 1000) / 1000;
      const cumulative = all.slice(0, index + 1).reduce((sum, item) => sum + (Number(item.profit) || 0), 0);
      return {
        ...row,
        profit,
        cumulative: Math.round(cumulative * 1000) / 1000,
      };
    });

  return {
    points,
    bucket: mode,
    selectable: false,
    label: mode === "month" ? "tháng" : "tuần",
  };
}
