import type { AnalysisReport } from "../shared/types.ts";
import { formatPct, formatPriceMove, formatRaw } from "./format.ts";

export interface ComparedAnalysis {
  id: string;
  label: string;
  report: AnalysisReport;
}

export function compareAnalyses(items: ComparedAnalysis[]) {
  const metrics = [
    row("Window", items, (report) => (report.launch.windowSeconds === null ? null : `${Math.round(report.launch.windowSeconds / 60)} min`)),
    row("Starting liquidity", items, (report) => formatRaw(report.launch.initialWethRaw, report.quote.decimals, 6) + " " + report.quote.symbol),
    row("Initial FDV (quote)", items, (report) => formatRaw(report.launch.initialFdvWethRaw, report.quote.decimals, 4)),
    row("Peak FDV (USD est.)", items, (report) => (report.launch.ath.fdvUsd === null ? null : `$${Math.round(report.launch.ath.fdvUsd).toLocaleString("en-US")}`)),
    row("Largest drawdown", items, (report) => formatPriceMove(report.launch.maxDrawdown.pct)),
    row("Quote volume", items, (report) => formatRaw(report.summary.volumeWethRaw, report.quote.decimals, 4)),
    row("Unique buy addresses", items, (report) => String(report.summary.uniqueBuyers)),
    row("Known external buy share", items, (report) => (report.external.status === "computed" ? `${report.external.knownExternalBuyVolumePct?.toFixed(2) ?? "—"}%` : "Not assessed")),
    row("Buy/sell quote ratio", items, (report) => (report.summary.buySellRatio === null ? null : report.summary.buySellRatio.toFixed(3))),
    row("Ending / peak reserve", items, (report) => {
      const peak = report.series.reduce((max, point) => Math.max(max, point.reserveWeth), 0);
      const end = report.series.at(-1)?.reserveWeth ?? 0;
      return peak > 0 ? formatPct(end / peak) : null;
    }),
    row("Source verified", items, (report) => (report.security.verified === null ? "Not assessed" : report.security.verified ? "Yes" : "No")),
    row("Top buyer share", items, (report) => {
      const total = BigInt(report.summary.buyWethRaw || "0");
      const top = report.wallets.filter((wallet) => wallet.buyCount).sort((a, b) => (BigInt(a.buyWethRaw) > BigInt(b.buyWethRaw) ? -1 : 1))[0];
      if (!top || total === 0n) return null;
      return `${(Number((BigInt(top.buyWethRaw) * 10000n) / total) / 100).toFixed(1)}%`;
    }),
  ];
  const numbers = items.map((item) => ({
    id: item.id,
    buyers: item.report.summary.uniqueBuyers,
    retention: reserveRatio(item.report),
    external: item.report.external.knownExternalBuyVolumePct,
  }));
  const improved: string[] = [];
  const deteriorated: string[] = [];
  if (numbers.length >= 2) {
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    noteChange(improved, deteriorated, "Unique buy addresses", last.buyers - first.buyers);
    if (first.retention !== null && last.retention !== null) noteChange(improved, deteriorated, "Ending/peak quote reserve", last.retention - first.retention);
    if (first.external !== null && last.external !== null) noteChange(improved, deteriorated, "Known-external buy volume share", last.external - first.external);
  }
  return {
    metrics,
    improved,
    deteriorated,
    caveat: "Differences are measured changes between these reports. A higher number is not evidence that one launch caused the other result.",
  };
}

function reserveRatio(report: AnalysisReport): number | null {
  const peak = report.series.reduce((max, point) => Math.max(max, point.reserveWeth), 0);
  const end = report.series.at(-1)?.reserveWeth ?? 0;
  return peak > 0 ? end / peak : null;
}

function noteChange(improved: string[], deteriorated: string[], label: string, delta: number) {
  if (Math.abs(delta) < 1e-9) return;
  const text = `${label} is ${delta > 0 ? "higher" : "lower"} on the last selected report.`;
  if (delta > 0) improved.push(text);
  else deteriorated.push(text);
}

function row(label: string, items: ComparedAnalysis[], read: (report: AnalysisReport) => string | null) {
  return { label, values: items.map((item) => read(item.report)) };
}
