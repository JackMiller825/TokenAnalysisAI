import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { SeriesMarker, UTCTimestamp } from "lightweight-charts";
import { api, isStaticDemo, type AnalysisReport } from "@/lib/api";
import { CATEGORY_COLOR, categoryLabel, formatPriceMove, formatRaw, formatUsd, shortAddr } from "@/lib/format";
import { useUi } from "@/store/ui";
import { Badge, Button, Card, Input, Progress, Switch } from "@/components/ui";
import { CandleChart, FlowChart, Sankey, VolumeChart } from "@/components/charts";
import { Addr, CategoryPill, Confidence, DataTable, Empty, Metric, Time, TxLink, WalletEditor } from "@/components/widgets";
import type { LaunchContext } from "../../../shared/types.ts";

export function ReportPage() {
  const { id = "", section } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["analysis", id],
    queryFn: () => api.analysis(id),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });
  const progress = useQuery({
    queryKey: ["progress", id],
    queryFn: () => api.progress(id),
    enabled: query.isLoading || query.data?.status === "queued" || query.data?.status === "running",
    refetchInterval: (q) => (q.state.data && ["completed", "failed", "cancelled"].includes(q.state.data.status) ? false : 1000),
  });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading the analysis…</p>;
  if (query.error) return <p className="text-sm text-red-300">{(query.error as Error).message}</p>;
  const row = query.data!;
  const report = row.report;
  const running = row.status === "queued" || row.status === "running";
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-cyan-300">{row.tokenSymbol || "Pair"} / {row.quoteSymbol || "WETH"}</p>
          <h1 className="text-2xl font-semibold md:text-3xl">{titleFor(section)}</h1>
          <p className="mono mt-1 text-xs text-muted-foreground">{row.pairAddress}</p>
        </div>
        {report ? (
          <div className="flex flex-wrap gap-2">
            {isStaticDemo ? (
              <>
                <button type="button" className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm" onClick={() => import("@/lib/staticApi").then((mod) => mod.downloadSnapshot(id, "json"))}>JSON</button>
                <button type="button" className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm" onClick={() => import("@/lib/staticApi").then((mod) => mod.downloadSnapshot(id, "csv"))}>CSV</button>
              </>
            ) : (
              <>
                <a className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm" href={`/api/analyses/${id}/export?format=json`}>JSON</a>
                <a className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm" href={`/api/analyses/${id}/export?format=csv`}>CSV</a>
                <a className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm" href={`/api/analyses/${id}/export?format=pdf`}>PDF</a>
              </>
            )}
          </div>
        ) : null}
      </header>
      {running || row.status === "failed" || row.status === "cancelled" ? <ProgressCard status={row.status} error={row.error} progress={progress.data} onCancel={() => api.cancel(id)} /> : null}
      {!report && row.status === "completed" ? <Empty title="Report missing" body="The job completed without a stored report." /> : null}
      {report ? <Section section={section} report={report} context={row.context} onSaved={() => client.invalidateQueries({ queryKey: ["analysis", id] })} id={id} /> : null}
    </div>
  );
}

function titleFor(section?: string) {
  switch (section) {
    case "timeline": return "Launch timeline";
    case "buyers": return "Buyer analysis";
    case "sellers": return "Seller analysis";
    case "wallets": return "Wallet intelligence";
    case "flows": return "WETH flow analysis";
    case "liquidity": return "Liquidity investigation";
    case "chart": return "Price and volume";
    case "security": return "Contract security";
    case "diagnosis": return "Strengths and weaknesses";
    case "recommendations": return "Improvement plan";
    case "team": return "Team performance";
    default: return "Analysis overview";
  }
}

function ProgressCard({ status, error, progress, onCancel }: { status: string; error: string | null; progress?: { progress: number; progressDetail: string; indeterminate: boolean; stages: { label: string; state: string }[] } | null; onCancel: () => void }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium capitalize">{status}</div>
          <div className="text-sm text-muted-foreground">{progress?.progressDetail || "Waiting for the worker."}</div>
        </div>
        {status === "queued" || status === "running" ? <Button variant="secondary" onClick={onCancel}>Cancel</Button> : null}
      </div>
      {progress?.indeterminate ? <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-pulse bg-cyan-400" /></div> : <Progress value={progress?.progress || (status === "failed" ? 100 : 2)} />}
      <div className="text-xs text-muted-foreground">{progress ? `${Math.round(progress.progress)}% of staged work. Percentages follow completed stage weight plus the fraction of the current batch.` : "Connecting to progress."}</div>
      <ol className="grid gap-1 md:grid-cols-2">
        {(progress?.stages || []).map((stage) => <li key={stage.label} className={stage.state === "done" ? "text-emerald-300" : stage.state === "active" ? "text-cyan-200" : "text-muted-foreground"}>{stage.state === "done" ? "✓" : stage.state === "active" ? "…" : "○"} {stage.label}</li>)}
      </ol>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </Card>
  );
}

function Section({ section, report, context, id, onSaved }: { section?: string; report: AnalysisReport; context: LaunchContext; id: string; onSaved: () => void }) {
  switch (section) {
    case "timeline": return <Timeline report={report} />;
    case "buyers": return <Buyers report={report} />;
    case "sellers": return <Sellers report={report} />;
    case "wallets": return <Wallets report={report} context={context} id={id} onSaved={onSaved} />;
    case "flows": return <Flows report={report} />;
    case "liquidity": return <Liquidity report={report} />;
    case "chart": return <ChartPage report={report} />;
    case "security": return <Security report={report} />;
    case "diagnosis": return <Diagnosis report={report} />;
    case "recommendations": return <Recommendations report={report} />;
    case "team": return <Team report={report} context={context} id={id} onSaved={onSaved} />;
    default: return <Overview report={report} />;
  }
}

function Overview({ report }: { report: AnalysisReport }) {
  const q = report.quote.symbol;
  const d = report.quote.decimals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Initial liquidity" value={`${formatRaw(report.launch.initialWethRaw, d, 4)} ${q}`} hint={report.launch.firstLiquidityTx ? shortAddr(report.launch.firstLiquidityTx) : ""} />
        <Metric label="Final reserve" value={`${formatRaw(report.launch.finalWethRaw, d, 8)} ${q}`} hint={`${formatRaw(report.launch.finalTokenRaw, report.token.decimals, 2)} ${report.token.symbol}`} />
        <Metric label="Unique buy addresses" value={String(report.summary.uniqueBuyers)} hint="Addresses, not people" />
        <Metric label="Peak FDV" value={formatUsd(report.launch.ath.fdvUsd)} hint={`${formatRaw(report.launch.ath.fdvWethRaw, d, 3)} ${q}`} />
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {report.scores.map((score) => (
          <Card key={score.id} className="p-3">
            <div className="text-xs text-muted-foreground">{score.label}</div>
            <div className="text-2xl font-semibold">{score.status === "scored" ? score.score : "N/A"}</div>
            <div className="text-xs text-muted-foreground">{score.status === "scored" ? "Scored" : "Not Assessed"}</div>
          </Card>
        ))}
      </div>
      <Card className="p-4 text-sm leading-6">
        <div className="mb-2 flex items-center gap-2"><h2 className="font-medium">Executive summary</h2><Badge>Evidence narrative</Badge></div>
        <p>{report.narrative.executive}</p>
        {report.narrative.aiProse ? <p className="mt-3 border-t border-border pt-3 text-muted-foreground">{report.narrative.aiProse}</p> : null}
        <p className="mt-3 text-xs text-muted-foreground">{report.narrative.aiNote} {report.overall.disclaimer}</p>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4"><h2 className="font-medium">What the evidence supports</h2><ul className="mt-2 space-y-2 text-sm">{report.worked.map((item) => <li key={item.id}><span className="text-emerald-300">{item.title}.</span> {item.summary}</li>)}{!report.worked.length ? <li className="text-muted-foreground">No strength cleared the thresholds.</li> : null}</ul></Card>
        <Card className="p-4"><h2 className="font-medium">What the evidence shows went wrong</h2><ul className="mt-2 space-y-2 text-sm">{report.failed.map((item) => <li key={item.id}><span className="text-red-300">{item.title}.</span> {item.summary}</li>)}</ul></Card>
      </div>
      <Card className="p-4 text-sm">
        <h2 className="font-medium">Completeness</h2>
        <ul className="mt-2 space-y-1">{report.completeness.map((item) => <li key={item.id}><span className="uppercase text-cyan-200">{item.state}</span> — {item.label}: {item.detail}</li>)}</ul>
      </Card>
    </div>
  );
}

function Timeline({ report }: { report: AnalysisReport }) {
  const [kind, setKind] = useState("all");
  const events = report.liquidityEvents.filter((event) => kind === "all" || event.kind === kind);
  const markers = [
    ["First liquidity", report.launch.firstLiquidityTx, report.liquidityEvents.find((event) => event.kind === "mint")?.timestamp],
    ["First swap", report.launch.firstSwapTx, report.launch.firstSwapTimestamp],
    ["Peak price", report.launch.ath.txHash, report.launch.ath.timestamp],
    ["First large sell", report.launch.firstMajorSellTx, report.trades.find((trade) => trade.txHash === report.launch.firstMajorSellTx)?.timestamp],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">{markers.map(([label, hash, time]) => <Card key={label} className="p-3 text-sm"><div className="text-muted-foreground">{label}</div><div className="mt-1"><Time unix={time ?? null} /></div><TxLink hash={hash} /></Card>)}</div>
      <p className="text-sm text-muted-foreground">{report.narrative.timeline}</p>
      <div className="flex gap-2">{["all", "mint", "burn", "transfer"].map((item) => <Button key={item} variant={kind === item ? "default" : "outline"} onClick={() => setKind(item)}>{item}</Button>)}</div>
      <DataTable columns={[{ key: "time", label: "Time" }, { key: "kind", label: "Event" }, { key: "note", label: "Effect" }, { key: "tx", label: "Transaction" }]} rows={events.slice(0, 200).map((event) => ({ time: <Time unix={event.timestamp} />, kind: event.kind, note: event.note, tx: <TxLink hash={event.txHash} /> }))} />
    </div>
  );
}

function Buyers({ report }: { report: AnalysisReport }) {
  const d = report.quote.decimals;
  const buyers = report.wallets.filter((wallet) => wallet.buyCount > 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Buying addresses" value={String(report.summary.uniqueBuyers)} />
        <Metric label="Known external buyers" value={String(report.external.knownExternalBuyers)} hint={report.external.status === "not_provided" ? "Not assessed" : `${report.external.knownExternalBuyerSharePct?.toFixed(2)}% of buyers`} />
        <Metric label="Known external buy volume" value={`${formatRaw(report.external.knownExternalBuyWethRaw, d, 4)} ${report.quote.symbol}`} hint={report.external.knownExternalBuyVolumePct === null ? "Not assessed" : `${report.external.knownExternalBuyVolumePct.toFixed(2)}%`} />
        <Metric label="Median buy" value={`${formatRaw(report.summary.medianBuyWethRaw, d, 4)} ${report.quote.symbol}`} />
      </div>
      <Card className="p-4 text-sm leading-6">
        <h2 className="font-medium">Organic demand analysis</h2>
        <p className="mt-2">{report.narrative.organic}</p>
        {report.external.assumption ? <p className="mt-2 text-amber-200">{report.external.assumption.label} Treated-as-team buy volume share: {report.external.assumption.treatedAsTeamBuyVolumePct?.toFixed(2) ?? "—"}%. {report.external.assumption.note}</p> : null}
      </Card>
      <VolumeChart data={report.perMinute.slice(0, 180).map((row) => ({ label: new Date(row.time * 1000).toISOString().slice(11, 16), buy: row.buyWeth, sell: row.sellWeth }))} />
      <DataTable columns={[{ key: "addr", label: "Address" }, { key: "cat", label: "Category" }, { key: "buys", label: "Buys" }, { key: "weth", label: "WETH in" }, { key: "first", label: "First" }]} rows={buyers.slice(0, 80).map((wallet) => ({ addr: <><Addr address={wallet.address} /> {wallet.label}</>, cat: <CategoryPill category={wallet.category} />, buys: wallet.buyCount, weth: formatRaw(wallet.buyWethRaw, d, 4), first: <Time unix={wallet.firstTimestamp} /> }))} />
    </div>
  );
}

function Sellers({ report }: { report: AnalysisReport }) {
  const d = report.quote.decimals;
  const [open, setOpen] = useState<string | null>(null);
  const selected = report.sellers.find((seller) => seller.address === open);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Immediate impact is the price change inside that swap. A large sale during a decline is not, by itself, the cause of every later candle.</p>
      <DataTable onRow={(index) => setOpen(report.sellers[index]?.address || null)} columns={[{ key: "addr", label: "Seller" }, { key: "cat", label: "Category" }, { key: "weth", label: "WETH received" }, { key: "impact", label: "Largest immediate impact" }, { key: "tx", label: "Largest sale" }]} rows={report.sellers.slice(0, 40).map((seller) => ({ addr: <Addr address={seller.address} />, cat: <CategoryPill category={seller.category} />, weth: formatRaw(seller.wethRaw, d, 6), impact: formatPriceMove(seller.largestImpact), tx: <TxLink hash={seller.largestTxHash} /> }))} />
      {selected ? <Card className="p-4 text-sm"><h2 className="font-medium">Selected seller</h2><p className="mt-2">{shortAddr(selected.address)} sold {formatRaw(selected.tokenRaw, report.token.decimals, 2)} {report.token.symbol} for {formatRaw(selected.wethRaw, d, 6)} {report.quote.symbol}. The largest fill left {formatPriceMove(selected.largestImpact)} inside <TxLink hash={selected.largestTxHash} />. ATH window: {selected.aroundAth ? "a sale fell within three minutes of the peak print" : "no sale in the three minutes around the peak"}. Drawdown window: {selected.duringDrawdown ? "a sale landed between the running peak and the trough" : "no sale in that drawdown window"}.</p></Card> : null}
    </div>
  );
}

function Wallets({ report, context, id, onSaved }: { report: AnalysisReport; context: LaunchContext; id: string; onSaved: () => void }) {
  return (
    <div className="space-y-4">
      <Editor context={context} id={id} onSaved={onSaved} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><h2 className="font-medium">Relationship graph</h2><Graph report={report} /><p className="mt-2 text-xs text-muted-foreground">Edges are direct token transfers with the launch operator. Confidence is plausible, not proof of common control.</p></Card>
        <Card className="p-4 text-sm"><h2 className="font-medium">Category share of buy quote</h2>{report.categories.map((row) => <div key={row.category} className="mt-2"><div className="flex justify-between"><span>{categoryLabel(row.category)}</span><span>{formatRaw(row.buyWethRaw, report.quote.decimals, 4)}</span></div></div>)}</Card>
      </div>
      {report.external.status === "computed" ? (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">External buyer performance</h2>
          {report.wallets.filter((wallet) => wallet.category === "known_external").map((wallet) => (
            <Card key={wallet.address} className="grid gap-2 p-4 text-sm md:grid-cols-3">
              <div><div className="font-medium">{wallet.label || "Known external"}</div><Addr address={wallet.address} /><div className="text-xs text-muted-foreground">{wallet.notes}</div></div>
              <div>First <Time unix={wallet.firstTimestamp} /><br />Last <Time unix={wallet.lastTimestamp} /><br />Holding span {wallet.holdingSeconds === null ? "—" : `${Math.round(wallet.holdingSeconds / 60)} min`}</div>
              <div>Bought {formatRaw(wallet.buyTokenRaw, report.token.decimals, 2)} / sold {formatRaw(wallet.sellTokenRaw, report.token.decimals, 2)}<br />Spent {formatRaw(wallet.buyWethRaw, 18, 6)} / received {formatRaw(wallet.sellWethRaw, 18, 6)}<br />Remaining {formatRaw(wallet.remainingTokenRaw, report.token.decimals, 2)}<br />Realized {wallet.realizedPnlStatus}: {formatRaw(wallet.realizedPnlWethRaw, 18, 6)} WETH<br /><span className="text-xs text-muted-foreground">{wallet.realizedPnlNote}</span><br />Pool price after entry {formatPriceMove(wallet.priceChangeAfterEntry)}</div>
            </Card>
          ))}
        </div>
      ) : <Card className="p-4 text-sm">{report.external.message}</Card>}
    </div>
  );
}

function Graph({ report }: { report: AnalysisReport }) {
  const nodes = [report.launchOperator.address, ...report.wallets.slice(0, 10).map((wallet) => wallet.address)].filter(Boolean) as string[];
  const unique = [...new Set(nodes)];
  return (
    <svg viewBox="0 0 520 280" className="w-full">
      {report.edges.slice(0, 12).map((edge) => {
        const a = unique.indexOf(edge.from);
        const b = unique.indexOf(edge.to);
        if (a < 0 || b < 0) return null;
        const p1 = point(a, unique.length);
        const p2 = point(b, unique.length);
        return <line key={`${edge.from}-${edge.to}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#fbbf24" strokeWidth="1.5" />;
      })}
      {unique.map((address, index) => {
        const p = point(index, unique.length);
        const wallet = report.wallets.find((item) => item.address === address);
        const color = address === report.launchOperator.address ? "#22d3ee" : CATEGORY_COLOR[wallet?.category || "unclassified"];
        return <g key={address}><circle cx={p.x} cy={p.y} r="14" fill={color} /><text x={p.x} y={p.y + 28} textAnchor="middle" fill="#cbd5e1" fontSize="10">{shortAddr(address)}</text></g>;
      })}
    </svg>
  );
}

function point(index: number, count: number) {
  const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
  return { x: 260 + Math.cos(angle) * 150, y: 130 + Math.sin(angle) * 90 };
}

function Flows({ report }: { report: AnalysisReport }) {
  const d = report.quote.decimals;
  const data = report.series.filter((_, index) => index % Math.ceil(report.series.length / 180) === 0).map((point) => ({ label: new Date(point.time * 1000).toISOString().slice(11, 16), reserve: point.reserveWeth, net: point.cumulativeNetWeth, buyers: point.uniqueBuyers }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Buy inflows" value={formatRaw(report.flows.buyInWethRaw, d, 4)} />
        <Metric label="Sell outflows" value={formatRaw(report.flows.sellOutWethRaw, d, 4)} />
        <Metric label="Discrepancy" value={formatRaw(report.flows.discrepancyRaw, d, 8)} hint={report.flows.balanced ? "Balanced within 2 wei" : "See note"} />
      </div>
      <Card className="p-4 text-sm leading-6">{report.flows.note} Pool outflows are WETH leaving the pair. They are a recipient's profit only after that wallet's cost basis, fees, and transfers are accounted for.</Card>
      <Card className="p-4"><h2 className="mb-2 font-medium">Quote reserve and cumulative net flow</h2><FlowChart data={data} lines={[{ key: "reserve", color: "#22d3ee", name: "Reserve" }, { key: "net", color: "#fbbf24", name: "Seed + buys − sells" }]} /></Card>
      <Card className="p-4"><h2 className="mb-2 font-medium">WETH movement map</h2><Sankey links={report.flows.sankey} /></Card>
      <Card className="p-4"><h2 className="mb-2 font-medium">Unique buyer growth</h2><FlowChart data={data} lines={[{ key: "buyers", color: "#34d399", name: "Unique buy addresses" }]} /></Card>
    </div>
  );
}

function Liquidity({ report }: { report: AnalysisReport }) {
  const [sim, setSim] = useState({ initialWeth: 0.8, initialTokens: 1000000000, buys: "0.2, 0.5", sells: "10000000" });
  const decimals = report.token.decimals;
  const result = useQuery({
    queryKey: ["sim", sim],
    queryFn: () => api.simulate({ initialWeth: sim.initialWeth, initialTokens: sim.initialTokens, tokenDecimals: decimals, buys: splitNums(sim.buys), sells: splitNums(sim.sells) }),
  });
  const reserve = report.series.filter((_, index) => index % Math.ceil(report.series.length / 160) === 0).map((point) => ({ label: new Date(point.time * 1000).toISOString().slice(11, 16), weth: point.reserveWeth, token: point.reserveToken }));
  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm leading-6"><h2 className="font-medium">Custody versus reserves</h2><p className="mt-2">{report.liquidity.explanation}</p><p className="mt-2">{report.liquidity.lock.detail}</p><p className="mt-2">LP supply {formatRaw(report.liquidity.lpSupplyRaw, 18, 4)}. Burn address {formatRaw(report.liquidity.burnedRaw, 18, 4)}. Zero address {formatRaw(report.liquidity.lockedInZeroRaw, 18, 6)}. Operator LP {formatRaw(report.liquidity.operatorLpRaw, 18, 4)}. Burn events: {report.liquidity.removedViaBurn ? "present" : "none in the indexed range"}.</p></Card>
      <Card className="p-4"><h2 className="mb-2 font-medium">Reserve path</h2><FlowChart data={reserve} lines={[{ key: "weth", color: "#22d3ee", name: "WETH reserve" }]} /></Card>
      <Card className="p-4"><h2 className="mb-2 font-medium">Token reserve</h2><FlowChart data={reserve} lines={[{ key: "token", color: "#a78bfa", name: `${report.token.symbol} reserve` }]} /></Card>
      <Card className="p-4 text-sm">
        <h2 className="font-medium">Current pool price impact</h2>
        <ul className="mt-2 space-y-1">{report.liquidity.priceImpact.map((row) => <li key={row.sizeWeth}>{row.sizeWeth} {report.quote.symbol}: {row.impactPct === null ? row.note : `${row.impactPct.toFixed(2)}% impact, about ${row.outTokens} tokens. ${row.note}`}</li>)}</ul>
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="font-medium">Next-launch liquidity simulation</h2>
        <p className="text-sm text-muted-foreground">Hypothetical constant-product trades. They are not a forecast of who will trade.</p>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm">Initial WETH<Input type="number" value={sim.initialWeth} onChange={(event) => setSim({ ...sim, initialWeth: Number(event.target.value) })} /></label>
          <label className="text-sm">Initial tokens<Input type="number" value={sim.initialTokens} onChange={(event) => setSim({ ...sim, initialTokens: Number(event.target.value) })} /></label>
          <label className="text-sm">Hypothetical buys, WETH<Input value={sim.buys} onChange={(event) => setSim({ ...sim, buys: event.target.value })} /></label>
          <label className="text-sm">Hypothetical sells, tokens<Input value={sim.sells} onChange={(event) => setSim({ ...sim, sells: event.target.value })} /></label>
        </div>
        {result.data ? <div className="text-sm"><p>{result.data.note}</p><ul className="mt-2 space-y-1">{result.data.steps.map((step) => <li key={step.label}>{step.label}: reserves {step.reserveWeth.toFixed(4)} WETH / {step.reserveToken.toLocaleString()} tokens, price {step.priceWeth.toExponential(3)}, impact {step.impact === null ? "—" : formatPriceMove(step.impact)}</li>)}</ul></div> : null}
      </Card>
    </div>
  );
}

function ChartPage({ report }: { report: AnalysisReport }) {
  const { chartCategories, toggleCategory } = useUi();
  const [interval, setInterval] = useState<keyof AnalysisReport["candles"]>("1m");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const candles = useMemo(() => {
    const rows = report.candles[interval] || [];
    const start = from ? Date.parse(from) / 1000 : null;
    const end = to ? Date.parse(to) / 1000 : null;
    return rows.filter((candle) => (start ? candle.time >= start : true) && (end ? candle.time <= end : true));
  }, [report, interval, from, to]);
  const markers = useMemo(() => {
    if (interval !== "1m") return [];
    return report.trades.filter((trade) => chartCategories.includes(trade.category)).map((trade) => ({
      time: (Math.floor(trade.timestamp / 60) * 60) as UTCTimestamp,
      position: trade.side === "buy" ? "belowBar" as const : "aboveBar" as const,
      color: CATEGORY_COLOR[trade.category] || "#94a3b8",
      shape: trade.side === "buy" ? "arrowUp" as const : "arrowDown" as const,
      text: `${categoryLabel(trade.category).split(" ")[0]} ${trade.side}`,
    })) satisfies SeriesMarker<UTCTimestamp>[];
  }, [report, chartCategories, interval]);
  const volume = candles.map((candle) => ({ label: new Date(candle.time * 1000).toISOString().slice(11, 16), buy: candle.buyWeth, sell: candle.sellWeth }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{(["1m", "5m", "15m", "1h", "4h", "1d", "all"] as const).map((item) => <Button key={item} variant={interval === item ? "default" : "outline"} onClick={() => setInterval(item)}>{item}</Button>)}</div>
      <div className="flex flex-wrap gap-2">{Object.keys(CATEGORY_COLOR).map((category) => <Button key={category} variant={chartCategories.includes(category) ? "secondary" : "outline"} onClick={() => toggleCategory(category)}>{categoryLabel(category)}</Button>)}</div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm">From <Input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-sm">To <Input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <Card className="p-3"><CandleChart candles={candles} markers={markers} onSelect={(candle) => setSelected(candle.txHashes)} /></Card>
      {selected.length ? <Card className="p-3 text-sm">Trades in that candle: {selected.map((hash) => <span key={hash} className="mr-3"><TxLink hash={hash} /></span>)}</Card> : null}
      <Card className="p-3"><h2 className="mb-2 font-medium">Buy and sell quote</h2><VolumeChart data={volume} /></Card>
      <p className="text-sm text-muted-foreground">Markers on the 1-minute chart use the category filter. Known external entries are colored cyan. Empty minutes are omitted rather than filled.</p>
    </div>
  );
}

function Security({ report }: { report: AnalysisReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Source verified" value={report.security.verified ? "Yes" : "No"} hint={report.security.verificationSource} />
        <Metric label="Safety rating" value="Not Assessed" hint={report.security.safetyNote} />
        <Metric label="Proxy slot" value={report.security.isProxy ? "EIP-1967 value present" : "Empty"} />
      </div>
      <Card className="p-4 text-sm leading-6"><p>{report.security.ownerNote} owner() = {report.security.owner || "no value"}.</p><p className="mt-2">{report.security.honeypot.detail}</p><p className="mt-2">{report.security.quoteCheck}</p></Card>
      <DataTable columns={[{ key: "sig", label: "Selector" }, { key: "meaning", label: "Meaning if it is real" }, { key: "present", label: "Byte sequence present" }]} rows={report.security.selectors.map((row) => ({ sig: <span className="mono text-xs">{row.signature}</span>, meaning: row.meaning, present: row.present ? "Yes, unverified" : "Not found" }))} />
    </div>
  );
}

function Diagnosis({ report }: { report: AnalysisReport }) {
  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm"><h2 className="font-medium">Scorecard</h2><p className="mt-1 text-muted-foreground">Overall {report.overall.status === "scored" ? report.overall.score : "Not Assessed"}. {report.overall.disclaimer}</p>{report.scores.map((score) => <div key={score.id} className="mt-3 border-t border-border pt-3"><div className="font-medium">{score.label}: {score.status === "scored" ? score.score : "Not Assessed"}</div><p>{score.explanation}</p><p className="text-xs text-muted-foreground">{score.formula}</p></div>)}</Card>
      <FindingList title="What worked" items={report.worked} />
      <FindingList title="What went wrong" items={report.failed} />
      <Card className="p-4 text-sm"><h2 className="font-medium">Still unknown</h2><ul className="mt-2 list-disc pl-5">{report.narrative.unanswered.map((item) => <li key={item}>{item}</li>)}</ul></Card>
    </div>
  );
}

function FindingList({ title, items }: { title: string; items: AnalysisReport["failed"] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {items.map((item) => (
        <Card key={item.id} className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{item.title}</h3><Confidence value={item.confidence} /></div>
          <p>{item.whatHappened}</p>
          <ul>{item.evidence.map((entry) => <li key={entry.label}>{entry.label}: {entry.txHash ? <TxLink hash={entry.txHash}>{entry.value}</TxLink> : entry.value}</li>)}</ul>
          <p><span className="text-muted-foreground">Mechanism. </span>{item.mechanism}</p>
          <p><span className="text-muted-foreground">Effect. </span>{item.effect}</p>
          <p><span className="text-muted-foreground">Unknown. </span>{item.unknown}</p>
          <p><span className="text-muted-foreground">What would settle it. </span>{item.whatWouldHelp}</p>
        </Card>
      ))}
    </div>
  );
}

function Recommendations({ report }: { report: AnalysisReport }) {
  const groups = ["token_trust", "liquidity_design", "community", "operations", "risk"] as const;
  const labels: Record<string, string> = { token_trust: "Token trust", liquidity_design: "Liquidity design", community: "Organic community growth", operations: "Launch operations", risk: "Risk management" };
  return (
    <div className="space-y-5">
      {report.recommendations.map((item) => (
        <Card key={item.id} className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap gap-2"><Badge className="uppercase text-amber-200">{item.priority}</Badge><Badge>{labels[item.category]}</Badge><Confidence value={item.confidence} /></div>
          <p><span className="text-muted-foreground">Problem. </span>{item.problem}</p>
          <p><span className="text-muted-foreground">Evidence. </span>{item.evidence}</p>
          <p><span className="text-muted-foreground">Root cause. </span>{item.rootCause}</p>
          <p><span className="text-muted-foreground">Recommended action. </span>{item.action}</p>
          <p><span className="text-muted-foreground">Verification. </span>{item.verification}</p>
          <p><span className="text-muted-foreground">Difficulty. </span>{item.difficulty}</p>
          <p><span className="text-muted-foreground">Cost. </span>{item.cost}</p>
          <p><span className="text-muted-foreground">Time. </span>{item.time}</p>
          <p><span className="text-muted-foreground">Success metrics. </span>{item.successMetrics}</p>
          <p><span className="text-muted-foreground">Dependencies. </span>{item.dependencies}</p>
          <p><span className="text-muted-foreground">Expected outcome. </span>{item.expectedOutcome}</p>
        </Card>
      ))}
      {groups.map((group) => {
        const rows = report.recommendations.filter((item) => item.category === group);
        return <Card key={group} className="p-4 text-sm"><h2 className="font-medium">{labels[group]}</h2>{rows.length ? <ul className="mt-2 list-disc pl-5">{rows.map((item) => <li key={item.id}>{item.action}</li>)}</ul> : <p className="mt-2 text-muted-foreground">No recommendation in this category was generated from the current findings.</p>}</Card>;
      })}
    </div>
  );
}

function Team({ report, context, id, onSaved }: { report: AnalysisReport; context: LaunchContext; id: string; onSaved: () => void }) {
  const team = report.wallets.filter((wallet) => wallet.category === "confirmed_team");
  const fields = [context.website, context.socials, context.communitySizeNote, context.launchTimingNote, context.marketingSpendNote, context.campaignNotes];
  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm"><h2 className="font-medium">Operator</h2><p className="mt-2"><Addr address={report.launchOperator.address} /> — {report.launchOperator.evidence}</p><p className="mt-2 text-muted-foreground">User-supplied notes stay separate from chain figures. Website: {context.website || "not supplied"}. Socials: {context.socials || "not supplied"}. Community: {context.communitySizeNote || "not supplied"}. Marketing: {context.marketingSpendNote || "not supplied"}.</p><p className="mt-2">Operations disclosure fields filled: {fields.filter((item) => item?.trim()).length} of 6. {report.scores.find((score) => score.id === "operations")?.explanation}</p></Card>
      {team.length ? <DataTable columns={[{ key: "addr", label: "Team wallet" }, { key: "buy", label: "Buy WETH" }, { key: "sell", label: "Sell WETH" }]} rows={team.map((wallet) => ({ addr: <Addr address={wallet.address} />, buy: formatRaw(wallet.buyWethRaw, 18, 4), sell: formatRaw(wallet.sellWethRaw, 18, 4) }))} /> : <Empty title="No confirmed team wallets" body="Team performance is limited to the launch operator until you label team addresses. Unclassified wallets are not filled in here." />}
      <Editor context={context} id={id} onSaved={onSaved} />
    </div>
  );
}

function Editor({ context, id, onSaved }: { context: LaunchContext; id: string; onSaved: () => void }) {
  const [draft, setDraft] = useState(context);
  const save = useMutation({ mutationFn: () => api.recalculate(id, draft, false), onSuccess: () => onSaved() });
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">Edit known external wallets and recalculate</h2>
      <WalletEditor wallets={draft.externalWallets} onChange={(externalWallets) => setDraft({ ...draft, externalWallets })} />
      <label className="flex items-center gap-2 text-sm"><Switch checked={draft.assumptionTreatUnlistedAsTeam} onCheckedChange={(checked) => setDraft({ ...draft, assumptionTreatUnlistedAsTeam: checked })} /> Assumption scenario for unlisted wallets</label>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Recalculating…" : "Recalculate classification"}</Button>
      {save.error ? <p className="text-sm text-red-300">{(save.error as Error).message}</p> : null}
    </Card>
  );
}

function splitNums(value: string): number[] {
  return value.split(/[^0-9.]+/).map(Number).filter((item) => item > 0);
}
