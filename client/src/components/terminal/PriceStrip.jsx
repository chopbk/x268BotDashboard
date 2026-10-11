import { fmt } from "./format.js";

/** R1: strip mức giá Entry/Mark/SL/TP — không giả candlestick. */
export default function PriceStrip({ entry, mark, sl, tp }) {
  const levels = [
    { id: "entry", label: "Entry", value: Number(entry), color: "var(--term-entry, #6b8cae)" },
    { id: "mark", label: "Mark", value: Number(mark), color: "var(--term-mark, #c4a35a)" },
    { id: "sl", label: "SL", value: Number(sl), color: "var(--term-sl, #c45c5c)" },
    { id: "tp", label: "TP", value: Number(tp), color: "var(--term-tp, #5a9e6f)" },
  ].filter((item) => Number.isFinite(item.value) && item.value > 0);

  if (levels.length < 2) {
    return <p className="muted term-price-strip-empty">Chưa đủ mức giá để vẽ strip.</p>;
  }

  const min = Math.min(...levels.map((l) => l.value));
  const max = Math.max(...levels.map((l) => l.value));
  const span = max - min || 1;
  const pad = span * 0.08;

  return (
    <div className="term-price-strip" aria-label="Mức giá Entry/Mark/SL/TP">
      <svg viewBox="0 0 320 56" role="img">
        <line x1="16" y1="28" x2="304" y2="28" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        {levels.map((level) => {
          const x = 16 + ((level.value - min + pad) / (span + pad * 2)) * 288;
          return (
            <g key={level.id}>
              <circle cx={x} cy="28" r="5" fill={level.color} />
              <text x={x} y="14" textAnchor="middle" fontSize="9" fill="currentColor">{level.label}</text>
              <text x={x} y="48" textAnchor="middle" fontSize="9" fill="currentColor">{fmt(level.value)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
