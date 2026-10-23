import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

/**
 * Nến + EMA20/50/200 + markers entry/SL/TP.
 */
export default function CandleChart({ candles = [], ema = null, levels = null }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = createChart(ref.current, {
      layout: {
        background: { color: "#151619" },
        textColor: "#a8a8b4",
      },
      grid: {
        vertLines: { color: "#303138" },
        horzLines: { color: "#303138" },
      },
      rightPriceScale: { borderColor: "#303138" },
      timeScale: { borderColor: "#303138" },
      width: ref.current.clientWidth,
      height: 280,
    });
    const series = chart.addCandlestickSeries({
      upColor: "#91d6b4",
      downColor: "#f3a5ad",
      borderVisible: false,
      wickUpColor: "#91d6b4",
      wickDownColor: "#f3a5ad",
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
  }, []);

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
        { key: "ema20", color: "#6ea8fe", value: ema.ema20 },
        { key: "ema50", color: "#e6c07b", value: ema.ema50 },
        { key: "ema200", color: "#c678dd", value: ema.ema200 },
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
        color: "#ededf0",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Entry",
      });
    }
    if (levels?.stopLoss != null) {
      ctx.series.createPriceLine({
        price: levels.stopLoss,
        color: "#f3a5ad",
        lineWidth: 1,
        lineStyle: 2,
        title: "SL",
      });
    }
    if (levels?.takeProfit != null) {
      ctx.series.createPriceLine({
        price: levels.takeProfit,
        color: "#91d6b4",
        lineWidth: 1,
        lineStyle: 2,
        title: "TP",
      });
    }

    ctx.chart.timeScale().fitContent();
  }, [candles, ema, levels]);

  return <div className="mdash-chart" ref={ref} />;
}
