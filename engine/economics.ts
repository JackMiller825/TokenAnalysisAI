import type {
  CategoryVolume,
  GraphEdge,
  LaunchContext,
  SellerRow,
  TradeRow,
  WalletCategory,
  WalletProfile,
} from "../shared/types.ts";
import { CEX_LABELS, DEAD, INFRA_LABELS, V2_ROUTER, WETH, ZERO } from "./decode.ts";
import { medianBig, sumBig } from "./format.ts";

export interface TokenTransfer {
  from: string;
  to: string;
  raw: string;
  txHash: string;
  timestamp: number;
  logIndex: number;
}

const CATEGORIES: WalletCategory[] = [
  "known_external",
  "confirmed_team",
  "suspected_related",
  "known_contract",
  "unclassified",
];

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function dedupeWallets<T extends { address: string; label?: string; notes?: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const address = normalizeAddress(row.address);
    const prev = map.get(address);
    map.set(address, {
      ...row,
      address,
      label: row.label || prev?.label || "",
      notes: row.notes || prev?.notes || "",
    });
  }
  return [...map.values()];
}

export function classifyActor(
  address: string,
  context: LaunchContext,
  isContract: boolean,
  suspected: Map<string, string[]>,
): { category: WalletCategory; confidence: number; reasons: string[]; label: string; notes: string } {
  const key = normalizeAddress(address);
  const external = context.externalWallets.find((item) => normalizeAddress(item.address) === key);
  if (external) {
    return {
      category: "known_external",
      confidence: 1,
      reasons: ["The user identified this address as not team-controlled."],
      label: external.label || "",
      notes: external.notes || "",
    };
  }
  const team = context.teamWallets.find((item) => normalizeAddress(item.address) === key);
  if (team) {
    return {
      category: "confirmed_team",
      confidence: 1,
      reasons: ["The user labeled this address as team-controlled."],
      label: team.label || "",
      notes: team.notes || "",
    };
  }
  const bot = context.botWallets.find((item) => normalizeAddress(item.address) === key);
  if (bot || INFRA_LABELS[key]) {
    return {
      category: "known_contract",
      confidence: 0.95,
      reasons: [bot ? "The user labeled this address as an automated trader." : `${INFRA_LABELS[key]} is public trading infrastructure.`],
      label: bot?.label || INFRA_LABELS[key] || "",
      notes: bot?.notes || "",
    };
  }
  const hints = suspected.get(key);
  if (hints?.length) {
    return {
      category: "suspected_related",
      confidence: 0.62,
      reasons: hints,
      label: "",
      notes: "",
    };
  }
  if (isContract) {
    return {
      category: "known_contract",
      confidence: 0.8,
      reasons: ["This address holds contract code. That identifies automation or infrastructure, not a person."],
      label: "",
      notes: "",
    };
  }
  return {
    category: "unclassified",
    confidence: 0,
    reasons: ["No user label and no direct on-chain link to the launch operator were found."],
    label: "",
    notes: "",
  };
}

export function suspectedFromTransfers(transfers: TokenTransfer[], operator: string | null, pool: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!operator) return map;
  const ignore = new Set([pool, ZERO, DEAD, WETH, V2_ROUTER].map(normalizeAddress));
  for (const transfer of transfers) {
    const from = normalizeAddress(transfer.from);
    const to = normalizeAddress(transfer.to);
    if (ignore.has(from) || ignore.has(to)) continue;
    if (from === normalizeAddress(operator)) {
      const reason = `Received tokens directly from the launch operator in ${transfer.txHash}. A direct transfer is a relationship, not proof of shared control.`;
      map.set(to, [...(map.get(to) ?? []), reason]);
    } else if (to === normalizeAddress(operator)) {
      const reason = `Sent tokens directly to the launch operator in ${transfer.txHash}. A direct transfer is a relationship, not proof of shared control.`;
      map.set(from, [...(map.get(from) ?? []), reason]);
    }
  }
  return map;
}

function add(raw: string, more: bigint): string {
  return (BigInt(raw) + more).toString();
}

export function buildEconomics(input: {
  trades: TradeRow[];
  context: LaunchContext;
  transfers: TokenTransfer[];
  operator: string | null;
  pool: string;
  finalPrice: string | null;
  athTimestamp: number | null;
  drawdownFrom: number | null;
  drawdownTo: number | null;
  endTimestamp: number;
}) {
  const context: LaunchContext = {
    ...input.context,
    externalWallets: dedupeWallets(input.context.externalWallets),
    teamWallets: dedupeWallets(input.context.teamWallets),
    botWallets: dedupeWallets(input.context.botWallets),
  };
  const suspected = suspectedFromTransfers(input.transfers, input.operator, input.pool);
  const contractFlags = new Map<string, boolean>();
  for (const trade of input.trades) contractFlags.set(normalizeAddress(trade.actor), trade.actorIsContract);

  const trades = input.trades.map((trade) => {
    const classified = classifyActor(trade.actor, context, trade.actorIsContract, suspected);
    return { ...trade, category: classified.category };
  });

  const byActor = new Map<string, TradeRow[]>();
  for (const trade of trades) {
    const key = normalizeAddress(trade.actor);
    byActor.set(key, [...(byActor.get(key) ?? []), trade]);
  }

  const pool = normalizeAddress(input.pool);
  const ignoreBalance = new Set([pool, ZERO.toLowerCase(), DEAD.toLowerCase()]);
  const balances = new Map<string, bigint>();
  const confounding = new Set<string>();
  for (const transfer of input.transfers) {
    const from = normalizeAddress(transfer.from);
    const to = normalizeAddress(transfer.to);
    const value = BigInt(transfer.raw);
    if (!ignoreBalance.has(from)) balances.set(from, (balances.get(from) ?? 0n) - value);
    if (!ignoreBalance.has(to)) balances.set(to, (balances.get(to) ?? 0n) + value);
    if (!ignoreBalance.has(from) && !ignoreBalance.has(to)) {
      confounding.add(from);
      confounding.add(to);
    }
  }

  const wallets: WalletProfile[] = [];
  for (const [address, rows] of byActor) {
    const classified = classifyActor(address, context, contractFlags.get(address) ?? false, suspected);
    const buys = rows.filter((row) => row.side === "buy");
    const sells = rows.filter((row) => row.side === "sell");
    const buyToken = sumBig(buys.map((row) => BigInt(row.tokenRaw)));
    const sellToken = sumBig(sells.map((row) => BigInt(row.tokenRaw)));
    const buyWeth = sumBig(buys.map((row) => BigInt(row.wethRaw)));
    const sellWeth = sumBig(sells.map((row) => BigInt(row.wethRaw)));
    const gas = sumBig([...new Map(rows.map((row) => [row.txHash, BigInt(row.gasWei || "0")])).values()]);
    const first = rows[0]?.timestamp ?? null;
    const last = rows[rows.length - 1]?.timestamp ?? null;
    const remaining = balances.has(address) ? balances.get(address)! : buyToken - sellToken;
    let realized: string | null = null;
    let realizedStatus: WalletProfile["realizedPnlStatus"] = "not_calculable";
    let realizedNote = "Realized PnL was not calculated.";
    if (buyToken === 0n && sellToken === 0n) {
      realizedNote = "This address has no decoded pool trades.";
    } else if (confounding.has(address) || sellToken > buyToken) {
      realizedStatus = "partial";
      realizedNote =
        "Inventory includes transfers or sales above recorded buys, so average-cost PnL would omit cost basis. WETH spent and WETH received are still exact trade flows.";
    } else if (buyToken > 0n) {
      const avgCost = (buyWeth * sellToken) / buyToken;
      realized = (sellWeth - avgCost).toString();
      realizedStatus = "calculated";
      realizedNote =
        "Average-cost estimate: WETH received minus (WETH spent × tokens sold ÷ tokens bought). Gas, taxes outside the swap event, and unrealized inventory are excluded.";
    }
    const entry = buys[0]?.priceAfter ?? sells[0]?.priceAfter ?? null;
    let priceChange: number | null = null;
    if (entry && input.finalPrice && entry !== "0/1") {
      const entryPx = rational(entry);
      const finalPx = rational(input.finalPrice);
      if (entryPx > 0) priceChange = (finalPx - entryPx) / entryPx;
    }
    const holding =
      first === null
        ? null
        : remaining > 0n
          ? Math.max(0, input.endTimestamp - first)
          : last !== null
            ? Math.max(0, last - first)
            : null;
    wallets.push({
      address,
      category: classified.category,
      label: classified.label,
      notes: classified.notes,
      isContract: contractFlags.get(address) ?? false,
      confidence: classified.confidence,
      reasons: classified.reasons,
      buyCount: buys.length,
      sellCount: sells.length,
      buyTokenRaw: buyToken.toString(),
      sellTokenRaw: sellToken.toString(),
      buyWethRaw: buyWeth.toString(),
      sellWethRaw: sellWeth.toString(),
      gasWei: gas.toString(),
      firstTimestamp: first,
      lastTimestamp: last,
      remainingTokenRaw: remaining.toString(),
      realizedPnlWethRaw: realized,
      realizedPnlStatus: realizedStatus,
      realizedPnlNote: realizedNote,
      unrealizedTokenRaw: remaining > 0n ? remaining.toString() : "0",
      holdingSeconds: holding,
      priceChangeAfterEntry: priceChange,
      txHashes: [...new Set(rows.map((row) => row.txHash))],
      funding: null,
    });
  }
  wallets.sort((a, b) => (BigInt(b.buyWethRaw) + BigInt(b.sellWethRaw) > BigInt(a.buyWethRaw) + BigInt(a.sellWethRaw) ? 1 : -1));

  const categories: CategoryVolume[] = CATEGORIES.map((category) => {
    const group = trades.filter((trade) => trade.category === category);
    const buyers = new Set(group.filter((trade) => trade.side === "buy").map((trade) => trade.actor));
    const sellers = new Set(group.filter((trade) => trade.side === "sell").map((trade) => trade.actor));
    return {
      category,
      buyWethRaw: sumBig(group.filter((trade) => trade.side === "buy").map((trade) => BigInt(trade.wethRaw))).toString(),
      sellWethRaw: sumBig(group.filter((trade) => trade.side === "sell").map((trade) => BigInt(trade.wethRaw))).toString(),
      buyCount: group.filter((trade) => trade.side === "buy").length,
      sellCount: group.filter((trade) => trade.side === "sell").length,
      buyers: buyers.size,
      sellers: sellers.size,
    };
  });

  const buyTrades = trades.filter((trade) => trade.side === "buy");
  const totalBuy = sumBig(buyTrades.map((trade) => BigInt(trade.wethRaw)));
  const external = categories.find((row) => row.category === "known_external")!;
  const unclassified = categories.find((row) => row.category === "unclassified")!;
  const uniqueBuyers = new Set(buyTrades.map((trade) => normalizeAddress(trade.actor))).size;
  const externalStatus = context.externalWallets.length ? "computed" : "not_provided";
  const assumptionBuyers = wallets.filter(
    (wallet) => wallet.buyCount > 0 && wallet.category !== "known_external" && wallet.category !== "known_contract",
  );
  const assumptionVolume = sumBig(assumptionBuyers.map((wallet) => BigInt(wallet.buyWethRaw)));

  const externalBlock = {
    status: externalStatus as "computed" | "not_provided",
    message: context.externalWallets.length
      ? "Known-external figures count only addresses the user identified. They are a lower bound on identified outside participation, not an estimate of all organic demand."
      : "External wallet ownership has not been established. Organic participation estimates are limited.",
    knownExternalBuyers: external.buyers,
    knownExternalSellers: external.sellers,
    knownExternalBuyWethRaw: external.buyWethRaw,
    knownExternalSellWethRaw: external.sellWethRaw,
    knownExternalNetFlowRaw: (BigInt(external.buyWethRaw) - BigInt(external.sellWethRaw)).toString(),
    knownExternalBuyVolumePct: totalBuy > 0n ? Number((BigInt(external.buyWethRaw) * 10000n) / totalBuy) / 100 : null,
    knownExternalBuyerSharePct: uniqueBuyers > 0 ? (external.buyers / uniqueBuyers) * 100 : null,
    unclassifiedBuyers: unclassified.buyers,
    unclassifiedBuyVolumePct: totalBuy > 0n ? Number((BigInt(unclassified.buyWethRaw) * 10000n) / totalBuy) / 100 : null,
    assumption: context.assumptionTreatUnlistedAsTeam
      ? {
          enabled: true as const,
          label: "Assumption: wallets outside the known-external list are treated as potentially team-associated.",
          treatedAsTeamBuyers: assumptionBuyers.length,
          treatedAsTeamBuyVolumePct: totalBuy > 0n ? Number((assumptionVolume * 10000n) / totalBuy) / 100 : null,
          note: "This scenario is not a verified classification. Unclassified and suspected wallets stay unclassified in the evidence tables.",
        }
      : null,
  };

  const sellers: SellerRow[] = wallets
    .filter((wallet) => wallet.sellCount > 0)
    .map((wallet) => {
      const sales = trades.filter((trade) => normalizeAddress(trade.actor) === wallet.address && trade.side === "sell");
      const largest = sales.reduce((best, trade) => (BigInt(trade.wethRaw) > BigInt(best.wethRaw) ? trade : best));
      const aroundAth =
        input.athTimestamp !== null && sales.some((trade) => Math.abs(trade.timestamp - input.athTimestamp!) <= 180);
      const duringDrawdown =
        input.drawdownFrom !== null &&
        input.drawdownTo !== null &&
        sales.some((trade) => trade.timestamp >= input.drawdownFrom! && trade.timestamp <= input.drawdownTo!);
      return {
        address: wallet.address,
        category: wallet.category,
        label: wallet.label,
        tokenRaw: wallet.sellTokenRaw,
        wethRaw: wallet.sellWethRaw,
        sellCount: wallet.sellCount,
        firstTimestamp: sales[0]?.timestamp ?? null,
        lastTimestamp: sales[sales.length - 1]?.timestamp ?? null,
        largestTxHash: largest.txHash,
        largestWethRaw: largest.wethRaw,
        largestImpact: largest.immediateImpact,
        aroundAth,
        duringDrawdown,
      };
    })
    .sort((a, b) => (BigInt(a.wethRaw) > BigInt(b.wethRaw) ? -1 : 1));

  const edges: GraphEdge[] = [];
  for (const [address, reasons] of suspected) {
    if (!input.operator) continue;
    edges.push({
      from: normalizeAddress(input.operator),
      to: address,
      reason: reasons[0],
      confidence: 0.62,
      confidenceLabel: "plausible",
    });
  }

  const buySizes = buyTrades.map((trade) => BigInt(trade.wethRaw));
  return {
    context,
    trades,
    wallets,
    categories,
    external: externalBlock,
    sellers,
    edges,
    uniqueBuyers,
    uniqueSellers: new Set(trades.filter((trade) => trade.side === "sell").map((trade) => normalizeAddress(trade.actor))).size,
    medianBuy: medianBig(buySizes)?.toString() ?? null,
    averageBuy: buySizes.length ? (sumBig(buySizes) / BigInt(buySizes.length)).toString() : null,
  };
}

function rational(value: string): number {
  const [n, d] = value.split("/");
  if (!d) return Number(value);
  const den = BigInt(d);
  if (den === 0n) return 0;
  const scale = 1_000_000_000_000n;
  return Number((BigInt(n) * scale) / den) / 1e12;
}

export { rational, CEX_LABELS };
