/**
 * Lịch PnL theo ngày UTC từ series { day, profit, trades, wins?, losses?, missing? }.
 * Ngày không có lệnh đã xác nhận = 0; ngày thiếu coverage = missing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDay(day) {
  const text = String(day || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Monday=0 … Sunday=6 for UTC day. */
export function utcWeekdayMon0(date) {
  const dow = date.getUTCDay(); // Sun=0
  return dow === 0 ? 6 : dow - 1;
}

export function buildCalendar(series) {
  const rows = (series || []).map((row) => ({
    day: String(row.day || "").slice(0, 10),
    profit: finite(row.profit),
    trades: Number(row.trades ?? row.count) || 0,
    wins: row.wins == null ? null : Number(row.wins) || 0,
    losses: row.losses == null ? null : Number(row.losses) || 0,
    missing: Boolean(row.missing),
    cumulative: finite(row.cumulative),
  })).filter((row) => parseDay(row.day));

  if (!rows.length) {
    return { weeks: [], cells: [], weekdays: WEEKDAYS, maxAbs: 1, months: [] };
  }

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const first = parseDay(rows[0].day);
  const last = parseDay(rows[rows.length - 1].day);
  const start = new Date(first.getTime() - utcWeekdayMon0(first) * DAY_MS);
  const endPad = 6 - utcWeekdayMon0(last);
  const end = new Date(last.getTime() + endPad * DAY_MS);

  const cells = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const date = new Date(t);
    const day = date.toISOString().slice(0, 10);
    const inRange = day >= rows[0].day && day <= rows[rows.length - 1].day;
    const hit = byDay.get(day);
    cells.push({
      day,
      inRange,
      profit: hit ? hit.profit : (inRange ? 0 : null),
      trades: hit ? hit.trades : 0,
      wins: hit?.wins ?? null,
      losses: hit?.losses ?? null,
      missing: hit ? hit.missing : false,
      cumulative: hit?.cumulative ?? null,
      monthLabel: date.getUTCDate() === 1 || (cells.length === 0 && inRange)
        ? `${date.getUTCMonth() + 1}/${String(date.getUTCFullYear()).slice(2)}`
        : "",
    });
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const valued = cells.filter((cell) => cell.inRange && !cell.missing && cell.profit != null);
  const maxAbs = Math.max(1, ...valued.map((cell) => Math.abs(cell.profit || 0)));

  return { weeks, cells, weekdays: WEEKDAYS, maxAbs, months: [] };
}

/** 5 mức mỗi phía âm/dương + 0. */
export function pnlLevel(profit, maxAbs, missing) {
  if (missing) return "missing";
  const n = finite(profit);
  if (n == null || n === 0) return "zero";
  const ratio = Math.min(1, Math.abs(n) / (maxAbs || 1));
  const step = ratio <= 0.2 ? 1 : ratio <= 0.4 ? 2 : ratio <= 0.6 ? 3 : ratio <= 0.8 ? 4 : 5;
  return n > 0 ? `pos-${step}` : `neg-${step}`;
}
