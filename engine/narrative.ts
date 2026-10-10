import type { AnalysisReport, Finding } from "../shared/types.ts";
import { formatPct, formatPriceMove, formatRaw, formatUsd } from "./format.ts";

function when(unix: number | null): string {
  if (!unix) return "an unknown time";
  return new Date(unix * 1000).toISOString().replace(".000Z", " UTC");
}

export function writeNarrative(report: AnalysisReport, worked: Finding[], failed: Finding[]): AnalysisReport["narrative"] {
  const q = report.quote.symbol || "QUOTE";
  const t = report.token.symbol || "TOKEN";
  const dec = report.quote.decimals;
  const tdec = report.token.decimals;
  const op = report.launchOperator.address;
  const lines: string[] = [];
  lines.push(
    `${t} traded against ${q} in pair ${report.pair.address} on chain ${report.chainId}. The indexed window is blocks ${report.blockRange.from ?? "—"} to ${report.blockRange.to ?? "—"}.`,
  );
  if (report.launch.firstLiquidityTx && report.launch.initialWethRaw) {
    lines.push(
      `The first Mint, in ${report.launch.firstLiquidityTx} at ${when(report.liquidityEvents.find((event) => event.kind === "mint")?.timestamp ?? null)}, deposited ${formatRaw(report.launch.initialTokenRaw, tdec, 4)} ${t} and ${formatRaw(report.launch.initialWethRaw, dec, 8)} ${q}. Spot price and FDV in this report use that reserve pair and the token total supply. USD figures multiply WETH by an ETH/USD reference (${report.ethUsd.source}) and are estimates.`,
    );
  }
  if (report.launch.ath.txHash && report.launch.ath.fdvUsd !== null) {
    lines.push(
      `The highest reserve price in the indexed swaps printed at ${when(report.launch.ath.timestamp)} in ${report.launch.ath.txHash}. Fully diluted value at that print was about ${formatRaw(report.launch.ath.fdvWethRaw, dec, 4)} ${q} (${formatUsd(report.launch.ath.fdvUsd)} at the ETH reference).`,
    );
  }
  if (report.launch.maxDrawdown.pct !== null) {
    lines.push(
      `From the running peak to the trough, ${formatPriceMove(report.launch.maxDrawdown.pct)}, between ${when(report.launch.maxDrawdown.fromTimestamp)} and ${when(report.launch.maxDrawdown.toTimestamp)}.`,
    );
  }
  lines.push(
    `The pool recorded ${report.summary.buys} buys and ${report.summary.sells} sells from ${report.summary.uniqueActors} sending addresses. Buy ${q} was ${formatRaw(report.summary.buyWethRaw, dec, 6)} and sell ${q} was ${formatRaw(report.summary.sellWethRaw, dec, 6)}.`,
  );
  if (op) {
    lines.push(`The address that submitted the initial liquidity transaction was ${op}. ${report.launchOperator.evidence}`);
  }
  lines.push(report.external.message);
  if (report.external.status === "computed") {
    lines.push(
      `Known-external buy volume was ${formatPct((report.external.knownExternalBuyVolumePct ?? 0) / 100)} of buy ${q} (${report.external.knownExternalBuyers} buying addresses, ${formatPct((report.external.knownExternalBuyerSharePct ?? 0) / 100)} of buying addresses). Their net flow, buy inputs minus sell outputs, was ${formatRaw(report.external.knownExternalNetFlowRaw, dec, 6)} ${q}. That net flow is not profit.`,
    );
  }
  if (report.external.assumption) {
    lines.push(report.external.assumption.note + " " + report.external.assumption.label);
  }
  lines.push(
    `Ending ${q} reserve was ${formatRaw(report.launch.finalWethRaw, dec, 12)} and ending ${t} reserve was ${formatRaw(report.launch.finalTokenRaw, tdec, 4)}. ${report.liquidity.explanation}`,
  );

  const timeline = report.liquidityEvents
    .filter((event) => event.kind === "mint" || event.kind === "burn")
    .slice(0, 6)
    .map((event) => `${when(event.timestamp)} ${event.kind} in ${event.txHash}: ${event.note}`)
    .join(" ");
  const firstSell = report.launch.firstMajorSellTx;
  const timelineText = [
    timeline,
    report.launch.firstSwapTx ? `First swap: ${report.launch.firstSwapTx} at ${when(report.launch.firstSwapTimestamp)}. ${report.launch.firstBuyerNote}` : "",
    firstSell ? `First large sell under the stated threshold: ${firstSell}.` : "",
    report.launch.ath.txHash ? `Peak reserve price: ${report.launch.ath.txHash} at ${when(report.launch.ath.timestamp)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const organic = [
    report.external.message,
    report.external.status === "computed"
      ? `Listed external wallets first traded at ${when(firstExternal(report))} and last traded at ${when(lastExternal(report))}.`
      : "Without a known-external list, the report cannot say whether buying was broad and independent.",
    `${report.external.unclassifiedBuyers} buying addresses are unclassified. Unclassified does not mean team and does not mean organic.`,
    report.edges.length
      ? `${report.edges.length} suspected relationships come from direct token transfers with the launch operator. Shared trade timing was not used.`
      : "No direct token-transfer relationship with the launch operator was found among non-pool addresses.",
  ].join(" ");

  const unanswered = [
    op ? "Which unclassified addresses, if any, were controlled by the launch operator." : "The contract creation transaction, if it was outside the indexed window.",
    "Why prospective buyers who never sent a transaction stayed out. That is not an on-chain fact.",
    report.security.verified ? "Whether the verified source matches the operator's description of taxes and mint rights." : "The permission model of the unverified bytecode.",
    "Website traffic, social engagement, and marketing conversion. None of those are inferred from swaps.",
  ];

  return {
    executive: lines.join(" "),
    timeline: timelineText || "The indexed event list did not include a mint or a swap.",
    organic,
    strengths: worked.length ? worked.map((item) => item.summary).join(" ") : "No evidence-backed strength cleared the report's thresholds.",
    weaknesses: failed.length ? failed.map((item) => item.summary).join(" ") : "No evidence-backed weakness cleared the report's thresholds.",
    unanswered,
    aiStatus: "not_configured",
    aiNote: "The narrative is assembled from the structured calculations. An optional model may rephrase it and is rejected if it introduces unknown addresses or hashes.",
    aiProse: null,
  };
}

function firstExternal(report: AnalysisReport): number | null {
  const times = report.wallets.filter((wallet) => wallet.category === "known_external" && wallet.firstTimestamp).map((wallet) => wallet.firstTimestamp!);
  return times.length ? Math.min(...times) : null;
}

function lastExternal(report: AnalysisReport): number | null {
  const times = report.wallets.filter((wallet) => wallet.category === "known_external" && wallet.lastTimestamp).map((wallet) => wallet.lastTimestamp!);
  return times.length ? Math.max(...times) : null;
}
