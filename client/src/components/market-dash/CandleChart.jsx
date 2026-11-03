import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import { readCssColor, useTheme } from "../../theme.jsx";

/**
 * Nến + EMA20/50/200 + markers entry/SL/TP.
 */
export default function CandleChart({ candles = [], ema = null, levels = null }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!ref.current) return undefined;
    const surface = readCssColor("--surface", "#161e2e");
    const textColor = readCssColor("--chart-text", "#a8a8b4");
    const line = readCssColor("--line", "#334155");
    const upColor = readCssColor("--ok", "#91d6b4");
    const downColor = readCssColor("--danger", "#f3a5ad");
    const chart = createChart(ref.current, {
      layout: {
        background: { color: surface },
        textColor,
      },
      grid: {
        vertLines: { color: line },
        horzLines: { color: line },
      },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line },
      width: ref.current.clientWidth,
      height: 280,
    });
    const series = chart.addCandlestickSeries({
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
    chartRef.current = { chart, series, emaLines: [] };

    const onResize = () => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const ctx = chartRef.current;
    if (!ctx || !candles?.length) return;
    const data = candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    ctx.series.setData(data);

    for (const line of ctx.emaLines) {
      try {
        ctx.chart.removeSeries(line);
      } catch {
        /* ignore */
      }
    }
    ctx.emaLines = [];

    if (ema && data.length) {
      const last = data[data.length - 1];
      const colors = [
        { key: "ema20", color: readCssColor("--chart-3", "#6ea8fe"), value: ema.ema20 },
        { key: "ema50", color: readCssColor("--chart-2", "#e6c07b"), value: ema.ema50 },
        { key: "ema200", color: readCssColor("--chart-4", "#c678dd"), value: ema.ema200 },
      ];
      for (const row of colors) {
        if (row.value == null) continue;
        const line = ctx.chart.addLineSeries({
          color: row.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: row.key,
        });
        // Horizontal last-value line across visible range (simple MVP)
        line.setData([
          { time: data[0].time, value: row.value },
          { time: last.time, value: row.value },
        ]);
        ctx.emaLines.push(line);
      }
    }

    if (levels?.entry != null) {
      ctx.series.createPriceLine({
        price: levels.entry,
        color: readCssColor("--text", "#f8fafc"),
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Entry",
      });
    }
    if (levels?.stopLoss != null) {
      ctx.series.createPriceLine({
        price: levels.stopLoss,
        color: readCssColor("--danger", "#f3a5ad"),
        lineWidth: 1,
        lineStyle: 2,
        title: "SL",
      });
    }
    if (levels?.takeProfit != null) {
      ctx.series.createPriceLine({
        price: levels.takeProfit,
        color: readCssColor("--ok", "#91d6b4"),
        lineWidth: 1,
        lineStyle: 2,
        title: "TP",
      });
    }

    ctx.chart.timeScale().fitContent();
  }, [candles, ema, levels]);

  return <div className="mdash-chart" ref={ref} />;
}
