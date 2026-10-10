import { useEffect, useRef } from "react";
import { ColorType, createChart, type ISeriesApi, type SeriesMarker, type UTCTimestamp } from "lightweight-charts";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Candle } from "../../../shared/types.ts";

export function CandleChart({ candles, markers, onSelect }: { candles: Candle[]; markers?: SeriesMarker<UTCTimestamp>[]; onSelect?: (candle: Candle) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 420,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#172033" }, horzLines: { color: "#172033" } },
      rightPriceScale: { borderColor: "#243044" },
      timeScale: { borderColor: "#243044", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor: "#34d399", downColor: "#f87171", borderUpColor: "#34d399", borderDownColor: "#f87171", wickUpColor: "#34d399", wickDownColor: "#f87171",
      priceFormat: { type: "custom", minMove: 1e-24, formatter: (price: number) => (price === 0 ? "0" : price.toExponential(3)) },
    });
    series.setData(candles.map((candle) => ({ time: candle.time as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
    if (markers?.length) series.setMarkers(markers);
    chart.timeScale().fitContent();
    chart.subscribeClick((param) => {
      const time = param.time as number | undefined;
      const candle = candles.find((item) => item.time === time);
      if (candle && onSelect) onSelect(candle);
    });
    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth || 600 }));
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [candles, markers, onSelect]);
  if (!candles.length) return <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">No candles in this window.</div>;
  return <div ref={ref} className="w-full" />;
}

export function FlowChart({ data, lines }: { data: Record<string, string | number>[]; lines: { key: string; color: string; name: string }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid stroke="#172033" />
          <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ background: "#0c1422", border: "1px solid #243044" }} />
          <Legend />
          {lines.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} name={line.name} stroke={line.color} dot={false} strokeWidth={2} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VolumeChart({ data }: { data: { label: string; buy: number; sell: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid stroke="#172033" />
          <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ background: "#0c1422", border: "1px solid #243044" }} />
          <Legend />
          <Bar dataKey="buy" name="Buy quote" fill="#34d399" />
          <Bar dataKey="sell" name="Sell quote" fill="#f87171" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sankey({ links }: { links: { source: string; target: string; weth: number }[] }) {
  const sources = [...new Set(links.filter((link) => link.target === "Pool").map((link) => link.source))];
  const targets = [...new Set(links.filter((link) => link.source === "Pool").map((link) => link.target))];
  const max = Math.max(...links.map((link) => link.weth), 0.000001);
  const height = Math.max(280, Math.max(sources.length, targets.length) * 36 + 24);
  const y = (index: number, count: number) => 20 + (index * (height - 40)) / Math.max(count, 1);
  return (
    <svg viewBox={`0 0 760 ${height}`} className="w-full">
      {sources.map((source, index) => {
        const link = links.find((item) => item.source === source && item.target === "Pool");
        const width = Math.max(2, ((link?.weth || 0) / max) * 18);
        const y1 = y(index, sources.length);
        return <path key={source} d={`M 180 ${y1} C 300 ${y1}, 360 ${height / 2}, 380 ${height / 2}`} stroke="#22d3ee" strokeWidth={width} fill="none" opacity={0.75} />;
      })}
      {targets.map((target, index) => {
        const link = links.find((item) => item.source === "Pool" && item.target === target);
        const width = Math.max(2, ((link?.weth || 0) / max) * 18);
        const y2 = y(index, targets.length);
        const color = target.startsWith("Sells") ? "#f87171" : "#fbbf24";
        return <path key={target} d={`M 380 ${height / 2} C 460 ${height / 2}, 520 ${y2}, 580 ${y2}`} stroke={color} strokeWidth={width} fill="none" opacity={0.8} />;
      })}
      <rect x="350" y={height / 2 - 18} width="60" height="36" rx="8" fill="#0e7490" />
      <text x="380" y={height / 2 + 4} textAnchor="middle" fill="white" fontSize="12">Pool</text>
      {sources.map((source, index) => <text key={source} x="170" y={y(index, sources.length) + 4} textAnchor="end" fill="#cbd5e1" fontSize="11">{source}</text>)}
      {targets.map((target, index) => <text key={target} x="590" y={y(index, targets.length) + 4} fill="#cbd5e1" fontSize="11">{target}</text>)}
    </svg>
  );
}
