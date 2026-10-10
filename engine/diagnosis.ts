import type { AnalysisReport, Confidence, Finding, Recommendation, ScoreItem } from "../shared/types.ts";
import { formatPct, formatPriceMove, formatRaw } from "./format.ts";
import { writeNarrative } from "./narrative.ts";

function finding(partial: Finding): Finding {
  return partial;
}

function formatMove(value: number): string {
  return formatPriceMove(value, 2);
}

function priceMoveSummary(txHash: string, impact: number): string {
  const remained = 1 + impact;
  if (impact > -1 && remained > 0 && remained < 1e-4) {
    return `Inside ${txHash}, ${remained.toExponential(3)} of the pre-swap spot price remained. The quote reserve after this swap was not zero.`;
  }
  return `Inside ${txHash}, the spot price moved by ${formatMove(impact)}. That change is only the reserve ratio before and after this swap.`;
}

export function applyAssessment(report: AnalysisReport): AnalysisReport {
  const wethDec = report.quote.decimals;
  const tokenDec = report.token.decimals;
  const sym = report.token.symbol || "TOKEN";
  const quote = report.quote.symbol || "QUOTE";
  const operator = report.launchOperator.address;
  const initial = report.launch.initialWethRaw ? BigInt(report.launch.initialWethRaw) : 0n;
  const finalWeth = report.launch.finalWethRaw ? BigInt(report.launch.finalWethRaw) : 0n;
  const buyWeth = BigInt(report.summary.buyWethRaw || "0");
  const sellWeth = BigInt(report.summary.sellWethRaw || "0");
  const peakReserve = report.series.reduce((max, point) => Math.max(max, point.reserveWeth), 0);
  const finalReserve = report.series.length ? report.series[report.series.length - 1].reserveWeth : 0;

  const worked: Finding[] = [];
  const failed: Finding[] = [];

  if (report.liquidity.burnedRaw && BigInt(report.liquidity.burnedRaw) > 0n && report.liquidity.lock.status === "burned") {
    worked.push(
      finding({
        id: "lp-burned",
        title: "LP tokens were sent to a burn address",
        summary: `${formatRaw(report.liquidity.burnedRaw, 18, 4)} LP tokens are held by the burn address.`,
        whatHappened: "LP tokens moved to the burn address. The Uniswap V2 minimum liquidity of 1000 wei sits at the zero address when that transfer is present.",
        evidence: [
          { label: "Burn-address LP balance", value: formatRaw(report.liquidity.burnedRaw, 18, 6), txHash: report.liquidity.burnTx ?? undefined },
          { label: "LP supply", value: formatRaw(report.liquidity.lpSupplyRaw, 18, 6) },
          { label: "removeLiquidity events", value: report.liquidity.removedViaBurn ? "At least one Burn event" : "No Burn events" },
        ],
        mechanism: "Sending LP tokens to a burn address prevents the holder of those LP tokens from calling removeLiquidity. It does not freeze the quote reserves.",
        effect: "The launch operator could not pull the initial deposit back out as an LP withdrawal. Quote tokens could still leave through swaps.",
        confidence: "confirmed",
        unknown: "A later mint of new LP tokens would be a separate event. None is implied by the burn transfer alone.",
        whatWouldHelp: "The LP Transfer to the burn address and a zero Burn-event count already settle this question for the indexed range.",
      }),
    );
  }

  if (report.flows.balanced) {
    worked.push(
      finding({
        id: "reserves-balanced",
        title: `${quote} reserve reconciliation closed`,
        summary: `Ending ${quote} matches initial deposits plus swap inflows minus swap outflows.`,
        whatHappened: report.flows.note,
        evidence: [
          { label: "Expected ending", value: `${formatRaw(report.flows.expectedFinalWethRaw, wethDec, 8)} ${quote}` },
          { label: "Last Sync reserve", value: `${formatRaw(report.flows.syncFinalWethRaw, wethDec, 8)} ${quote}` },
          { label: "ERC-20 balance", value: `${formatRaw(report.flows.erc20WethRaw, wethDec, 8)} ${quote}` },
        ],
        mechanism: "Each Swap and Mint event records the quote amount that entered or left the pair. The sum is compared with the final Sync reserve and the token balance.",
        effect: "Pool accounting for the indexed range does not depend on a chart screenshot.",
        confidence: "confirmed",
        unknown: "Events outside the indexed block range are not in this sum.",
        whatWouldHelp: "An archive provider covering any earlier gap, if the log scan was truncated.",
      }),
    );
  }

  if (report.summary.tokenTaxMedian !== null && report.summary.tokenTaxMedian > 0.97 && report.summary.tokenTaxMedian < 1.03) {
    worked.push(
      finding({
        id: "v2-quotes",
        title: "Swap outputs match the Uniswap V2 formula",
        summary: `Median actual output ÷ constant-product quote is ${report.summary.tokenTaxMedian.toFixed(4)}.`,
        whatHappened: report.summary.tokenTaxNote,
        evidence: [{ label: "Median actual/expected", value: report.summary.tokenTaxMedian.toFixed(4) }],
        mechanism: "Expected output uses amountOut = amountIn × 997 × reserveOut ÷ (reserveIn × 1000 + amountIn × 997), measured from the prior reserve.",
        effect: "The indexed swaps behave like a standard 0.30% pool. This does not rule out a tax taken before tokens reach the pair.",
        confidence: "confirmed",
        unknown: "A fee charged on the wallet before the pair's balance update would not appear in this ratio.",
        whatWouldHelp: "Compare the wallet's token transfer amount with the pair's amountIn on the same transaction.",
      }),
    );
  }

  if (report.summary.uniqueBuyers >= 15) {
    worked.push(
      finding({
        id: "many-addresses",
        title: "Many distinct addresses submitted buys",
        summary: `${report.summary.uniqueBuyers} buying addresses were observed.`,
        whatHappened: "Buy swaps were grouped by the transaction sender. That count is an address count.",
        evidence: [
          { label: "Unique buy senders", value: String(report.summary.uniqueBuyers) },
          { label: "Buy swaps", value: String(report.summary.buys) },
        ],
        mechanism: "One person can submit transactions from many addresses. The count is not a count of people.",
        effect: "The launch produced broad address-level activity. Independence of those addresses is a separate question.",
        confidence: "confirmed",
        unknown: "How many of those addresses were controlled by the operator or by independent participants.",
        whatWouldHelp: "A user-supplied known-external list, plus funding and direct-transfer evidence.",
      }),
    );
  }

  const retentionRatio = finalReserve > 0 && peakReserve > 0 ? finalReserve / peakReserve : finalWeth > 0n && initial > 0n ? Number(finalWeth) / Number(initial) : 0;
  if (initial > 0n && finalWeth * 1000n < initial && report.series.length) {
    failed.push(
      finding({
        id: "reserves-depleted",
        title: `${quote} reserves were depleted`,
        summary: `The pool ended at ${formatRaw(finalWeth, wethDec, 12)} ${quote} after starting at ${formatRaw(initial, wethDec, 6)} ${quote}.`,
        whatHappened: `Buyers sent ${formatRaw(buyWeth, wethDec, 6)} ${quote} into the pair and sellers withdrew ${formatRaw(sellWeth, wethDec, 6)} ${quote}.`,
        evidence: [
          { label: "Initial mint", value: `${formatRaw(initial, wethDec, 8)} ${quote}`, txHash: report.launch.firstLiquidityTx ?? undefined },
          { label: "Final Sync reserve", value: `${formatRaw(finalWeth, wethDec, 12)} ${quote}` },
          { label: "Burn events", value: report.liquidity.removedViaBurn ? "present" : "none in the indexed range" },
        ],
        mechanism: report.liquidity.removedViaBurn
          ? "Both swaps and LP Burn events reduced reserves."
          : "Reserves fell through swaps. Burned or locked LP tokens do not stop a trader from selling the base token into the pool.",
        effect: `Ending reserves retained about ${formatPct(retentionRatio)} of the peak observed ${quote} reserve. Displayed price can collapse when the quote side is emptied.`,
        confidence: "confirmed",
        unknown: "Off-chain reasons participants chose to sell are not visible in the logs.",
        whatWouldHelp: "The indexed Swap and Sync events already measure the reserve path.",
      }),
    );
  }

  if (operator) {
    const op = report.wallets.find((wallet) => wallet.address === operator.toLowerCase());
    if (op && sellWeth > 0n) {
      const share = Number((BigInt(op.sellWethRaw) * 10000n) / sellWeth) / 100;
      if (share >= 25) {
        failed.push(
          finding({
            id: "operator-sells",
            title: "The launch operator submitted a large share of sells",
            summary: `${op.address} received ${formatRaw(op.sellWethRaw, wethDec, 6)} ${quote} from sells, ${share.toFixed(1)}% of sell-side ${quote}.`,
            whatHappened: "Those swaps were sent by the same address that submitted the initial liquidity transaction. Router calldata identifies the ETH recipient when decoding succeeds.",
            evidence: [
              { label: "Operator sell proceeds", value: `${formatRaw(op.sellWethRaw, wethDec, 8)} ${quote}` },
              { label: "Largest operator sell", value: op.txHashes[0] ? op.txHashes[0] : "—", txHash: report.sellers.find((row) => row.address === op.address)?.largestTxHash },
              { label: "Share of sell ${quote}".replace("${quote}", quote), value: `${share.toFixed(2)}%` },
            ],
            mechanism: "swapExactTokensForETH sends the pair's WETH to the router, which unwraps and forwards ETH to the recipient in the calldata. The Swap event's `to` field is often the router, so the transaction sender is the actor.",
            effect: "A single address removed a material fraction of the quote that buyers had added. Each sale's immediate impact is on that swap's row and is separate from later candles.",
            confidence: "confirmed",
            unknown: "Whether other unclassified addresses were operated by the same person.",
            whatWouldHelp: "Labels for known external wallets, and any team addresses the operator chooses to disclose.",
          }),
        );
      }
    }
  }

  const worstSell = report.trades
    .filter((trade) => trade.side === "sell" && trade.immediateImpact !== null)
    .sort((a, b) => (a.immediateImpact ?? 0) - (b.immediateImpact ?? 0))[0];
  if (worstSell?.immediateImpact !== null && worstSell?.immediateImpact !== undefined && worstSell.immediateImpact <= -0.4) {
    failed.push(
      finding({
        id: "single-sell-impact",
        title: "One swap repriced the pool immediately",
        summary: priceMoveSummary(worstSell.txHash, worstSell.immediateImpact),
        whatHappened: "Immediate impact compares the reserve price before the swap with the reserve price after that same swap. This is the largest immediate move in the indexed sells, which may differ from the wallet with the largest total proceeds.",
        evidence: [
          { label: "Transaction", value: worstSell.txHash, txHash: worstSell.txHash },
          { label: "Sender", value: worstSell.actor },
          { label: `${quote} out`, value: formatRaw(worstSell.wethRaw, wethDec, 8) },
          { label: "Immediate impact", value: formatMove(worstSell.immediateImpact) },
        ],
        mechanism: "Constant-product reserves move to a new price as soon as the swap is mined. Later candles have their own swaps.",
        effect: "This sale explains its own price change. It is not, by itself, an explanation of every later print.",
        confidence: "confirmed",
        unknown: "How much of the later path was follow-on selling versus an empty book.",
        whatWouldHelp: "The reserve series after this transaction.",
      }),
    );
  }

  if (report.security.verified === false) {
    failed.push(
      finding({
        id: "unverified",
        title: "Token source is not verified",
        summary: report.security.verificationSource,
        whatHappened: "The analyzer checked Sourcify and, when a key was configured, Etherscan. Bytecode was still readable.",
        evidence: [
          { label: "Bytecode size", value: report.security.bytecodeBytes ? `${report.security.bytecodeBytes} bytes` : "—" },
          { label: "owner() result", value: report.security.owner ?? "call failed" },
        ],
        mechanism: "Unverified bytecode can contain trading limits, taxes, or mint functions that a selector scan only hints at.",
        effect: "Buyers could not read the permission model from a published source match at analysis time.",
        confidence: "confirmed",
        unknown: "The actual permission model. A safety rating is not assessed.",
        whatWouldHelp: "A verified source match on Sourcify or Etherscan, plus the deployment transaction.",
      }),
    );
  }

  if (report.external.status === "not_provided") {
    failed.push(
      finding({
        id: "external-unknown",
        title: "Independent participation was not identifiable",
        summary: "No known-external wallets were supplied, and unclassified addresses were not treated as organic buyers.",
        whatHappened: `${report.summary.uniqueBuyers} buying addresses remain a mix of possible team wallets, independent wallets, and contracts.`,
        evidence: [
          { label: "Unclassified buying addresses", value: String(report.external.unclassifiedBuyers) },
          { label: "Known external buying addresses", value: "0" },
        ],
        mechanism: "The analyzer only promotes a wallet to known-external when the user lists it. Shared timing or trade size is not used as ownership evidence.",
        effect: "Strengths that depend on organic demand stay limited. Address counts remain available.",
        confidence: "confirmed",
        unknown: "Which unclassified addresses, if any, were independent participants.",
        whatWouldHelp: "The external addresses the operator already knows were outside the team.",
      }),
    );
  } else if ((report.external.knownExternalBuyerSharePct ?? 0) < 15 || (report.external.knownExternalBuyVolumePct ?? 0) < 15) {
    failed.push(
      finding({
        id: "thin-external",
        title: "Identified external buying was a small share of activity",
        summary: `${report.external.knownExternalBuyers} known-external buyers contributed ${report.external.knownExternalBuyVolumePct?.toFixed(2) ?? "—"}% of buy ${quote}.`,
        whatHappened: "Only user-listed addresses are counted as known external. Every other non-contract, non-team address stays unclassified.",
        evidence: [
          { label: "Known external buy volume", value: `${formatRaw(report.external.knownExternalBuyWethRaw, wethDec, 6)} ${quote}` },
          { label: "Known external buyer share", value: `${report.external.knownExternalBuyerSharePct?.toFixed(2) ?? "—"}%` },
          { label: "Unclassified buy volume share", value: `${report.external.unclassifiedBuyVolumePct?.toFixed(2) ?? "—"}%` },
        ],
        mechanism: "The supplied list is a lower bound. Absence from the list is not evidence that a wallet is team-controlled.",
        effect: "Identified outside demand was small relative to total buy flow. Whether more outside demand exists inside the unclassified set is unknown.",
        confidence: "confirmed",
        unknown: "Why other participants did not appear, and whether unclassified wallets include more independent buyers.",
        whatWouldHelp: "A broader known-external list and off-chain discovery metrics the operator measured directly.",
      }),
    );
  } else {
    worked.push(
      finding({
        id: "external-present",
        title: "Known external wallets participated",
        summary: `${report.external.knownExternalBuyers} listed wallets bought ${formatRaw(report.external.knownExternalBuyWethRaw, wethDec, 6)} ${quote}.`,
        whatHappened: "Their trades are marked on the chart and separated from unclassified flow.",
        evidence: [
          { label: "Buy volume share", value: `${report.external.knownExternalBuyVolumePct?.toFixed(2) ?? "—"}%` },
          { label: "Net flow (buy inputs − sell outputs)", value: `${formatRaw(report.external.knownExternalNetFlowRaw, wethDec, 6)} ${quote}` },
        ],
        mechanism: "Net flow is pool accounting for those wallets. It is not realized profit.",
        effect: "There is identified outside participation. It does not describe wallets the user did not list.",
        confidence: "confirmed",
        unknown: "Any independent buyers who were not on the supplied list.",
        whatWouldHelp: "Labels for any additional outside wallets that traded.",
      }),
    );
  }

  const netExternal = BigInt(report.external.knownExternalNetFlowRaw || "0");
  if (report.external.status === "computed" && sellWeth > 0n && netExternal < 0n) {
    failed.push(
      finding({
        id: "external-did-not-offset",
        title: "Known external flow did not offset sell pressure",
        summary: `Listed wallets' net ${quote} flow was ${formatRaw(netExternal, wethDec, 6)} ${quote}.`,
        whatHappened: "Net flow subtracts their sell outputs from their buy inputs. Negative means they removed more quote than they added.",
        evidence: [
          { label: "External buys", value: formatRaw(report.external.knownExternalBuyWethRaw, wethDec, 6) },
          { label: "External sells", value: formatRaw(report.external.knownExternalSellWethRaw, wethDec, 6) },
          { label: "Total sells", value: formatRaw(sellWeth, wethDec, 6) },
        ],
        mechanism: "This comparison uses only the supplied addresses. It says nothing about unclassified wallets.",
        effect: "Identified outside flow was not large enough to replace the quote removed by sales across the whole pool.",
        confidence: "strongly_supported",
        unknown: "Unclassified buy flow may include additional independent demand.",
        whatWouldHelp: "Classification of the unclassified buyers.",
      }),
    );
  }

  const topBuyer = [...report.wallets].filter((wallet) => wallet.buyCount).sort((a, b) => (BigInt(a.buyWethRaw) > BigInt(b.buyWethRaw) ? -1 : 1))[0];
  if (topBuyer && buyWeth > 0n) {
    const share = Number((BigInt(topBuyer.buyWethRaw) * 10000n) / buyWeth) / 100;
    if (share >= 35) {
      failed.push(
        finding({
          id: "buy-concentration",
          title: "Buy flow was concentrated",
          summary: `${topBuyer.address} accounted for ${share.toFixed(1)}% of buy ${quote}.`,
          whatHappened: "Concentration uses transaction senders. It is an address statistic.",
          evidence: [
            { label: "Largest buyer", value: topBuyer.address },
            { label: "Category", value: topBuyer.category },
            { label: "Share", value: `${share.toFixed(2)}%` },
          ],
          mechanism: "A high share means the displayed buy volume depended on few addresses.",
          effect: "The chart was more sensitive to those addresses stopping or reversing.",
          confidence: "confirmed",
          unknown: "Whether that address represents one economic decision-maker.",
          whatWouldHelp: "A label for that address and its funding source.",
        }),
      );
    }
  }

  if (report.launch.initialWethRaw && report.userContextEcho.initialLiquidityNote) {
    const match = report.userContextEcho.initialLiquidityNote.match(/(\d+(\.\d+)?)/);
    if (match) {
      const stated = Number(match[1]);
      const actual = Number(formatRaw(report.launch.initialWethRaw, wethDec, 8));
      if (stated > 0 && Math.abs(stated - actual) / stated < 0.02) {
        worked.push(
          finding({
            id: "user-liquidity-match",
            title: "User-reported initial liquidity matches the mint",
            summary: `The note cited about ${stated} ${quote}. The first Mint deposited ${formatRaw(report.launch.initialWethRaw, wethDec, 8)} ${quote}.`,
            whatHappened: "The user-supplied note was compared with the first Mint event. The chain figure is the one used in accounting.",
            evidence: [{ label: "Mint", value: formatRaw(report.launch.initialWethRaw, wethDec, 8), txHash: report.launch.firstLiquidityTx ?? undefined }],
            mechanism: "String match within 2% of the parsed number.",
            effect: "The operator's recollection of the seed deposit agrees with the pair event.",
            confidence: "confirmed",
            unknown: "Nothing about later reserve changes.",
            whatWouldHelp: "No further evidence is required for the seed amount.",
          }),
        );
      }
    }
  }

  const scores = scoreReport(report);
  const numeric = scores.filter((item) => item.status === "scored" && item.score !== null).map((item) => item.score as number);
  const overall = {
    score: numeric.length ? Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length) : null,
    status: numeric.length ? ("scored" as const) : ("not_assessed" as const),
    disclaimer: "The average covers only categories with enough evidence. It is a diagnostic scorecard, not a safety rating, a profit forecast, or a prediction of the next launch.",
  };

  const recommendations = recommend(report, failed, worked, quote, sym);
  const narrative = writeNarrative(report, worked, failed);
  return { ...report, worked, failed, scores, overall, recommendations, narrative };
}

function scoreReport(report: AnalysisReport): ScoreItem[] {
  const buyers = report.summary.uniqueBuyers;
  const buyWeth = BigInt(report.summary.buyWethRaw || "0");
  let participation: ScoreItem;
  if (!report.summary.swaps) {
    participation = {
      id: "participation",
      label: "Market participation",
      score: null,
      status: "not_assessed",
      formula: "Requires decoded swaps.",
      explanation: "No swaps were decoded, so participation was not scored.",
      inputs: [],
    };
  } else {
    const breadth = Math.max(0, Math.min(40, buyers * 2));
    const top = report.wallets.filter((wallet) => wallet.buyCount).sort((a, b) => (BigInt(a.buyWethRaw) > BigInt(b.buyWethRaw) ? -1 : 1))[0];
    const topShare = top && buyWeth > 0n ? Number((BigInt(top.buyWethRaw) * 10000n) / buyWeth) / 10000 : 1;
    const diversity = Math.round((1 - topShare) * 40);
    const repeat = report.wallets.filter((wallet) => wallet.buyCount > 1).length;
    const retention = Math.max(0, Math.min(20, repeat));
    participation = {
      id: "participation",
      label: "Market participation",
      score: Math.max(0, Math.min(100, breadth + diversity + retention)),
      status: "scored",
      formula: "min(40, unique buy addresses × 2) + round((1 − largest buyer share) × 40) + min(20, addresses with more than one buy). Address counts are not people. Known-external participation is reported separately and is Not Assessed when no list is supplied.",
      explanation: "This score measures how widely observed buy flow was spread across sending addresses.",
      inputs: [
        { name: "Unique buy addresses", value: String(buyers) },
        { name: "Largest buyer share", value: `${(topShare * 100).toFixed(1)}%` },
        { name: "Repeat buyers", value: String(repeat) },
      ],
    };
  }

  const peak = report.series.reduce((max, point) => Math.max(max, point.reserveWeth), 0);
  const end = report.series.at(-1)?.reserveWeth ?? 0;
  const liquidity: ScoreItem = !report.series.length || peak <= 0
    ? {
        id: "liquidity",
        label: "Liquidity resilience",
        score: null,
        status: "not_assessed",
        formula: "Ending quote reserve ÷ peak quote reserve, from Sync events.",
        explanation: "Reserve history was not available.",
        inputs: [],
      }
    : {
        id: "liquidity",
        label: "Liquidity resilience",
        score: Math.round(Math.max(0, Math.min(1, end / peak)) * 100),
        status: "scored",
        formula: "round(100 × ending quote reserve ÷ peak quote reserve). LP burns do not increase this score. A burned LP can still sit beside an empty quote reserve.",
        explanation: "The score is the share of the peak quote reserve still in the pool at the last indexed Sync.",
        inputs: [
          { name: "Peak reserve", value: peak.toFixed(6) },
          { name: "Ending reserve", value: end.toFixed(8) },
        ],
      };

  const hhi = herfindahl(report.wallets.map((wallet) => BigInt(wallet.buyWethRaw)));
  const distribution: ScoreItem = buyWeth === 0n
    ? {
        id: "distribution",
        label: "Wallet distribution",
        score: null,
        status: "not_assessed",
        formula: "100 × (1 − Herfindahl of buy quote across sending addresses).",
        explanation: "There were no buys to distribute.",
        inputs: [],
      }
    : {
        id: "distribution",
        label: "Wallet distribution",
        score: Math.round((1 - hhi) * 100),
        status: "scored",
        formula: "100 × (1 − Σ share²) using each address's buy quote. 100 would be an even split across a very large set. The score does not prove distinct humans.",
        explanation: "Higher means buy quote was less concentrated in a few sending addresses.",
        inputs: [{ name: "Herfindahl", value: hhi.toFixed(4) }],
      };

  let transparency: ScoreItem;
  if (report.security.bytecodeBytes === null) {
    transparency = {
      id: "transparency",
      label: "Contract transparency",
      score: null,
      status: "not_assessed",
      formula: "Verified source match and ownership evidence.",
      explanation: "Bytecode could not be read.",
      inputs: [],
    };
  } else if (report.security.verified) {
    transparency = {
      id: "transparency",
      label: "Contract transparency",
      score: report.security.owner === "0x0000000000000000000000000000000000000000" ? 90 : 75,
      status: "scored",
      formula: "75 when source is verified. 90 when source is verified and owner() is the zero address. This is not a safety score.",
      explanation: "A published source match lets a reader inspect permissions. Safety remains a separate reading of that source.",
      inputs: [
        { name: "Verified", value: "yes" },
        { name: "owner()", value: report.security.owner ?? "—" },
      ],
    };
  } else {
    transparency = {
      id: "transparency",
      label: "Contract transparency",
      score: 25,
      status: "scored",
      formula: "25 when bytecode is available and no source match was found. Safety is Not Assessed. The score records disclosure, not exploit risk.",
      explanation: report.security.safetyNote,
      inputs: [
        { name: "Verified", value: "no" },
        { name: "Bytecode bytes", value: String(report.security.bytecodeBytes) },
      ],
    };
  }

  const fields = [
    report.userContextEcho.website,
    report.userContextEcho.socials,
    report.userContextEcho.communitySizeNote,
    report.userContextEcho.launchTimingNote,
    report.userContextEcho.marketingSpendNote,
    report.userContextEcho.campaignNotes,
  ].filter((value) => value.trim());
  const operations: ScoreItem = fields.length
    ? {
        id: "operations",
        label: "Launch operations",
        score: Math.round((fields.length / 6) * 100),
        status: "scored",
        formula: "100 × (supplied disclosure fields ÷ 6). Fields are website, socials, community size, timing, marketing spend, and campaign notes. The score measures what was entered, not the quality of the campaign.",
        explanation: "On-chain data cannot see website traffic or community response. Those inputs stay user-supplied.",
        inputs: [{ name: "Fields supplied", value: `${fields.length} of 6` }],
      }
    : {
        id: "operations",
        label: "Launch operations",
        score: null,
        status: "not_assessed",
        formula: "Requires the optional launch-context fields.",
        explanation: "No operational context was entered, so this category was left unscored.",
        inputs: [],
      };

  return [participation, liquidity, distribution, transparency, operations];
}

function herfindahl(values: bigint[]): number {
  const total = values.reduce((sum, value) => sum + (value > 0n ? value : 0n), 0n);
  if (total === 0n) return 1;
  let score = 0;
  for (const value of values) {
    if (value <= 0n) continue;
    const share = Number((value * 1_000_000n) / total) / 1_000_000;
    score += share * share;
  }
  return score;
}

function recommend(report: AnalysisReport, failed: Finding[], worked: Finding[], quote: string, sym: string): Recommendation[] {
  const cards: Recommendation[] = [];
  const has = (id: string) => failed.some((item) => item.id === id) || worked.some((item) => item.id === id);
  if (has("external-unknown") || has("thin-external")) {
    cards.push({
      id: "rec-external",
      problem: has("external-unknown") ? "No measurable identified independent buying demand." : "Known external wallets were a small share of buy flow.",
      evidence: report.external.message,
      rootCause: "Displayed trading activity was not tied to a list of wallets known to be outside the team, or that list was small relative to total buys.",
      confidence: "confirmed",
      action: "Before the next launch, publish how outsiders can discover the token and keep a list of wallets you know are not team-controlled. Enter that list here so the next report can separate them.",
      verification: "Compare known-external buyer count, known-external buy volume, and buyer retention on the next report. Do not treat unclassified addresses as the success metric.",
      priority: "critical",
      difficulty: "Operational. The on-chain part is recording addresses you already can identify.",
      cost: "No protocol fee. Any advertising cost is whatever the operator actually spends and should be entered as a user-supplied figure.",
      time: "The list can be entered as soon as the addresses are known. Discovery work happens before the launch.",
      successMetrics: "Known-external buy volume share and known-external buyer count, reported as a lower bound.",
      dependencies: "The operator must know which wallets are outside the team. The analyzer cannot invent that list.",
      expectedOutcome: "The next report can tell identified outside participation from unclassified activity. No price outcome is implied.",
      category: "community",
    });
  }
  if (has("reserves-depleted") || has("single-sell-impact")) {
    cards.push({
      id: "rec-liquidity",
      problem: `${quote} reserves did not absorb the observed sell sizes.`,
      evidence: `The pool started at ${formatRaw(report.launch.initialWethRaw, report.quote.decimals, 6)} ${quote} and ended at ${formatRaw(report.launch.finalWethRaw, report.quote.decimals, 12)} ${quote}.`,
      rootCause: "Sell flow exceeded the quote inventory buyers had left in the pair. LP custody, including a burn, does not replace quote inventory.",
      confidence: "confirmed",
      action: `Use the liquidity simulator to pick a starting ${quote} deposit that still has reserves after hypothetical independent sells of the sizes you actually saw here. Publish the LP custody plan at launch.`,
      verification: "On the next launch, compare ending reserve ÷ peak reserve and the immediate impact of the largest sell.",
      priority: "critical",
      difficulty: "Capital and disclosure. The simulator is available on the liquidity page.",
      cost: "Equal to the additional quote tokens the operator chooses to deposit. This report does not invent that budget.",
      time: "Decide the deposit before the liquidity transaction.",
      successMetrics: "Ending/peak quote reserve, and immediate impact of the largest sell.",
      dependencies: "Quote capital and a published LP plan.",
      expectedOutcome: "A deeper book changes price impact math. It does not create buyers and it does not guarantee a price.",
      category: "liquidity_design",
    });
  }
  if (has("unverified")) {
    cards.push({
      id: "rec-verify",
      problem: `${sym} source was not verified at analysis time.`,
      evidence: report.security.verificationSource,
      rootCause: "Traders could not read permissions from a matched source file.",
      confidence: "confirmed",
      action: "Verify the next token on Sourcify or Etherscan before trading opens. Publish ownership, mint rights, tax, and LP custody in the same note.",
      verification: "The security page should show a source match, and the transparency score should move under the published rubric.",
      priority: "high",
      difficulty: "Low if the compiler inputs are still available.",
      cost: "Verification on Sourcify is free. Etherscan verification does not require this app's API key.",
      time: "Before the first liquidity transaction.",
      successMetrics: "Source match present at the first indexed swap.",
      dependencies: "Original compiler settings and source.",
      expectedOutcome: "Readers can inspect permissions. Verification is not a promise that the contract is safe.",
      category: "token_trust",
    });
  }
  if (has("operator-sells")) {
    cards.push({
      id: "rec-policy",
      problem: "The launch operator's sells were a large share of quote removed from the pool.",
      evidence: failed.find((item) => item.id === "operator-sells")?.summary ?? "See seller table.",
      rootCause: "Team inventory could be sold into a pool that did not have offsetting identified external buys.",
      confidence: "confirmed",
      action: "Write a team transaction policy before the next launch: who may sell, after which public milestone, and where the proceeds go. Disclose it with the LP plan.",
      verification: "The next report should show operator sell share against that written policy, using the same address-attribution method.",
      priority: "high",
      difficulty: "A written policy and the discipline to follow it.",
      cost: "No on-chain cost. Opportunity cost is whatever sales the policy defers.",
      time: "Publish the policy before trading opens.",
      successMetrics: "Operator sell-side quote share, and whether sells occurred inside the published window.",
      dependencies: "Agreement among the people who control the inventory.",
      expectedOutcome: "Participants can see the rule before they trade. The policy does not set the price.",
      category: "risk",
    });
  }
  if (has("buy-concentration")) {
    cards.push({
      id: "rec-concentration",
      problem: "A small set of addresses dominated buy flow.",
      evidence: failed.find((item) => item.id === "buy-concentration")?.summary ?? "See buyer table.",
      rootCause: "The visible rally depended on concentrated address flow, whether or not those addresses were independent.",
      confidence: "confirmed",
      action: "Watch the largest sending addresses during the next launch and record which of them you know are external. Avoid manufacturing extra addresses; that would fake distribution.",
      verification: "Wallet-distribution score and largest-buyer share on the next report.",
      priority: "medium",
      difficulty: "Monitoring during the launch window.",
      cost: "Time. No paid data vendor is required for the on-chain half.",
      time: "During the launch and in the first recap.",
      successMetrics: "Largest buyer share and known-external buyer count.",
      dependencies: "Someone watching the live report.",
      expectedOutcome: "Concentration is visible while there is still time to communicate. It is not a trading signal.",
      category: "risk",
    });
  }
  if (!report.userContextEcho.website && !report.userContextEcho.socials) {
    cards.push({
      id: "rec-ops",
      problem: "No website or social presence was recorded for this launch.",
      evidence: "The optional context fields for website and socials were empty.",
      rootCause: "The report cannot judge discovery if the operator does not record where people were asked to look.",
      confidence: "confirmed",
      action: "For the next launch, enter the live website and the social URLs you actually used. Measure visits yourself. This app will not invent traffic from swaps.",
      verification: "Launch operations score moves from Not Assessed to a disclosure score, and the notes are visible on the team page.",
      priority: "medium",
      difficulty: "Record-keeping.",
      cost: "Whatever hosting already costs the project. Not estimated here.",
      time: "Before the liquidity transaction.",
      successMetrics: "The fields are present, and any analytics numbers the operator pastes are labeled user-supplied.",
      dependencies: "A page and a channel the operator controls.",
      expectedOutcome: "The next comparison can tell whether disclosure improved. It cannot attribute price changes to posts.",
      category: "operations",
    });
  }
  if (!cards.length) {
    cards.push({
      id: "rec-baseline",
      problem: "Keep the measurement loop for the next launch.",
      evidence: "This report separated confirmed reserve math from questions that still need labels.",
      rootCause: "A later launch can only be compared if the same definitions are used.",
      confidence: "confirmed",
      action: "Run the next pair through the same analyzer and compare participation, reserve retention, and known-external share.",
      verification: "The comparison page shows which measured values rose or fell, without calling the change a cause.",
      priority: "low",
      difficulty: "Repeat the same paste-and-analyze flow.",
      cost: "RPC capacity only. Public endpoints may truncate older history.",
      time: "After the next launch window.",
      successMetrics: "A completed comparison with completeness flags on both sides.",
      dependencies: "Both analyses indexed far enough to cover their launches.",
      expectedOutcome: "A factual before/after on the metrics this report defines. No performance promise.",
      category: "operations",
    });
  }
  return cards;
}

export function confidenceLabel(value: Confidence): string {
  switch (value) {
    case "confirmed":
      return "Confirmed";
    case "strongly_supported":
      return "Strongly supported";
    case "plausible":
      return "Plausible";
    case "unverified":
      return "Unverified";
    case "contradicted":
      return "Contradicted by evidence";
  }
}
