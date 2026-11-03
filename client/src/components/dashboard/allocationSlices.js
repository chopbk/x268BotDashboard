/**
 * Top-N coin + Khác cho donut — tái dùng quy tắc rankNotional.
 */

import { topNotionalGroups } from "../charts/rankNotional.js";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted)",
];

export function colorForIndex(index) {
  return COLORS[index % COLORS.length];
}

export function coinSlices(bySymbol, { limit = 5 } = {}) {
  const ranked = topNotionalGroups(
    (Array.isArray(bySymbol) ? bySymbol : []).map((row) => ({
      symbol: row.label || row.key,
      notional: row.value,
      key: row.key,
    })),
    { nameKey: "symbol", valueKey: "notional", limit }
  );
  const slices = ranked.shown.map((row, index) => ({
    key: row.id,
    label: row.name,
    value: row.value,
    color: colorForIndex(index),
  }));
  if (ranked.other) {
    const shownKeys = new Set(ranked.shown.map((row) => row.id));
    const source = Array.isArray(bySymbol) ? bySymbol : [];
    slices.push({
      key: "__other__",
      label: `Khác (${ranked.other.count})`,
      value: ranked.other.value,
      color: colorForIndex(slices.length),
      otherKeys: source
        .map((row) => row.key)
        .filter((key) => key && !shownKeys.has(key)),
    });
  }
  return { slices, total: ranked.total };
}

export function sideSlices(bySide) {
  const rows = Array.isArray(bySide) ? bySide : [];
  const long = rows.find((row) => String(row.key).toUpperCase() === "LONG");
  const short = rows.find((row) => String(row.key).toUpperCase() === "SHORT");
  const slices = [
    { key: "LONG", label: "Long", value: Math.abs(Number(long?.value) || 0), color: "var(--ok, #22a06b)" },
    { key: "SHORT", label: "Short", value: Math.abs(Number(short?.value) || 0), color: "var(--danger, #e5484d)" },
  ].filter((row) => row.value > 0);
  const total = slices.reduce((sum, row) => sum + row.value, 0);
  return { slices, total };
}

/** SVG donut arcs — angles from -90deg (top). */
export function donutArcs(slices, { size = 220, thickness = 28 } = {}) {
  const total = slices.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  if (!(total > 0)) return { paths: [], total: 0, cx: size / 2, cy: size / 2, r: (size / 2) - thickness / 2 };
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - thickness / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter - thickness;
  let angle = -Math.PI / 2;
  const paths = [];
  for (const slice of slices) {
    const value = Number(slice.value) || 0;
    if (!(value > 0)) continue;
    const sweep = (value / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + rOuter * Math.cos(angle);
    const y0 = cy + rOuter * Math.sin(angle);
    const x1 = cx + rOuter * Math.cos(end);
    const y1 = cy + rOuter * Math.sin(end);
    const x2 = cx + rInner * Math.cos(end);
    const y2 = cy + rInner * Math.sin(end);
    const x3 = cx + rInner * Math.cos(angle);
    const y3 = cy + rInner * Math.sin(angle);
    const d = [
      `M ${x0} ${y0}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
      `L ${x2} ${y2}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
      "Z",
    ].join(" ");
    paths.push({ ...slice, d, share: Math.round((value / total) * 1000) / 10 });
    angle = end;
  }
  return { paths, total, cx, cy, r };
}
