import { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { api } from "../../api";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"];

/**
 * Chart Terminal: nến + overlay entry/SL/TP/fills + drawing cơ bản.
 * Đổi symbol nhanh bỏ response cũ bằng requestSeq.
 * Chart lỗi không unmount sibling (parent giữ bảng vị thế).
 */
export default function TerminalChart({
  market = null,
  timeframe = "15m",
  onTimeframeChange,
  levels = null,
  fills = [],
  drawings = [],
  drawMode = null,
  onDrawingsChange,
  onLevelDrag,
  height = 280,
}) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const seqRef = useRef(0);
  const [error, setError] = useState("");
  const [quality, setQuality] = useState("missing");
  const [loading, setLoading] = useState(false);

  const symbol = market?.symbol || market?.instrumentId || "";
  const marketKey = [
    market?.exchange || "binance",
    market?.marketType || "usdt_perp_linear",
    String(symbol || "").toUpperCase(),
  ].join("|");

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const chart = createChart(hostRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "var(--muted, #a8a8b4)",
      },
      grid: {
        vertLines: { color: "rgba(80,80,100,0.25)" },
        horzLines: { color: "rgba(80,80,100,0.25)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      width: hostRef.current.clientWidth,
      height,
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#5a9e6f",
      downColor: "#c45c5c",
      borderVisible: false,
      wickUpColor: "#5a9e6f",
      wickDownColor: "#c45c5c",
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    chartRef.current = { chart, series, volume, priceLines: [], markers: [] };

    const onResize = () => {
      if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth, height });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const ctx = chartRef.current;
    if (!ctx || !symbol) {
      setQuality("missing");
      return undefined;
    }
    const seq = ++seqRef.current;
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const data = await api(
          `/api/terminal/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=120`
        );
        if (cancelled || seq !== seqRef.current) return;
        setQuality(data?.provenance?.quality || (data?.candles?.length ? "fresh" : "missing"));
        const candles = data?.candles || [];
        ctx.series.setData(candles);
        ctx.volume.setData(
          candles.map((c) => ({
            time: c.time,
            value: c.volume || 0,
            color: c.close >= c.open ? "rgba(90,158,111,0.35)" : "rgba(196,92,92,0.35)",
          }))
        );
        ctx.chart.timeScale().fitContent();
      } catch (err) {
        if (cancelled || seq !== seqRef.current) return;
        console.error("[TerminalChart]", err);
        setError(err.message || "Không tải được chart");
        setQuality("missing");
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    const ctx = chartRef.current;
    if (!ctx) return;
    for (const line of ctx.priceLines) {
      try {
        ctx.series.removePriceLine(line);
      } catch {
        /* ignore */
      }
    }
    ctx.priceLines = [];
    const add = (price, color, title) => {
      if (price == null || !Number.isFinite(Number(price))) return;
      const line = ctx.series.createPriceLine({
        price: Number(price),
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title,
      });
      ctx.priceLines.push(line);
    };
    add(levels?.entry, "#6b8cae", "Entry");
    add(levels?.stopLoss, "#c45c5c", "SL");
    add(levels?.takeProfit, "#5a9e6f", "TP");
    for (const fill of fills || []) {
      add(fill.price, "#c4a35a", fill.label || "Fill");
    }
    for (const d of drawings || []) {
      if (d.marketKey && d.marketKey !== marketKey) continue;
      if (d.kind === "hline" && d.points?.[0] != null) {
        add(d.points[0], d.color || "#8899aa", d.label || "H");
      }
      if (d.kind === "zone" && d.points?.length >= 2) {
        add(d.points[0], d.color || "#556677", d.label || "Z1");
        add(d.points[1], d.color || "#556677", d.label || "Z2");
      }
    }
  }, [levels, fills, drawings, marketKey]);

  function handleChartClick(event) {
    const ctx = chartRef.current;
    if (!ctx || !drawMode || !onDrawingsChange) return;
    const rect = hostRef.current.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const price = ctx.series.coordinateToPrice(y);
    if (price == null || !Number.isFinite(price)) return;

    if (drawMode === "entry" || drawMode === "stopLoss" || drawMode === "takeProfit") {
      onLevelDrag?.({ [drawMode]: Number(price.toFixed(6)) });
      return;
    }
    if (drawMode === "hline") {
      onDrawingsChange([
        ...(drawings || []),
        { marketKey, kind: "hline", points: [Number(price.toFixed(6))], label: "H" },
      ]);
    }
  }

  return (
    <div className="term-chart-wrap">
      <div className="term-chart-toolbar">
        <strong className="term-chart-symbol">{symbol || "—"}</strong>
        <span className={`term-badge ${quality === "fresh" ? "" : "term-badge-warn"}`}>{quality}</span>
        <div className="term-chart-tfs" role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={tf === timeframe ? "active" : ""}
              onClick={() => onTimeframeChange?.(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        {loading ? <span className="muted">Đang tải…</span> : null}
      </div>
      {error ? (
        <p className="term-warn-text" role="status">
          Chart lỗi: {error}. Bảng vị thế bên dưới vẫn dùng được.
        </p>
      ) : null}
      <div
        className="term-chart-host"
        ref={hostRef}
        role="img"
        aria-label={`Biểu đồ ${symbol || "trống"}`}
        onClick={handleChartClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.preventDefault();
        }}
      />
      <p className="muted term-chart-hint">
        Kéo/click chỉ sửa draft (entry/SL/TP/drawing) — không đặt lệnh. Phím tắt không market-submit.
      </p>
    </div>
  );
}
