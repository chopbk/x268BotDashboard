/**
 * Top-N theo gross notional (trị tuyệt đối) + phần "Khác".
 * Dùng cho Terminal Risk — không cộng trùng nguồn; caller đã chuẩn hóa.
 */

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function topNotionalGroups(rows, {
  nameKey = "symbol",
  valueKey = "notional",
  limit = 5,
} = {}) {
  const list = (rows || []).map((row, index) => {
    const name = row[nameKey] ?? row.symbol ?? `#${index + 1}`;
    const raw = finite(row[valueKey]);
    const value = raw == null ? null : Math.abs(raw);
    return {
      id: String(name),
      name: String(name),
      value,
      raw: row,
    };
  }).filter((row) => row.value != null && row.value > 0);

  const ranked = [...list].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const shown = ranked.slice(0, Math.max(1, limit));
  const rest = ranked.slice(shown.length);
  const otherValue = rest.reduce((sum, row) => sum + row.value, 0);
  const total = list.reduce((sum, row) => sum + row.value, 0);

  return {
    shown,
    other: otherValue > 0
      ? { id: "__other__", name: "Khác", value: otherValue, count: rest.length }
      : null,
    totalGroups: list.length,
    shownCount: shown.length,
    total,
    max: Math.max(1, ...shown.map((row) => row.value), otherValue || 0),
  };
}
