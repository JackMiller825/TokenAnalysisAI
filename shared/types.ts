export const ANALYSIS_VERSION = "2026.10.1";

export type WalletCategory =
  | "known_external"
  | "confirmed_team"
  | "suspected_related"
  | "known_contract"
  | "unclassified";

export type Confidence =
  | "confirmed"
  | "strongly_supported"
  | "plausible"
  | "unverified"
  | "contradicted";

export type ModuleState = "complete" | "partial" | "not_assessed" | "failed";

export interface ModuleStatus {
  id: string;
  label: string;
  state: ModuleState;
  detail: string;
}

export interface WalletInput {
  address: string;
  label?: string;
  notes?: string;
}

export interface LaunchContext {
  externalWallets: WalletInput[];
  teamWallets: WalletInput[];
  botWallets: WalletInput[];
  assumptionTreatUnlistedAsTeam: boolean;
  initialLiquidityNote: string;
  marketingSpendNote: string;
  launchTimingNote: string;
  communitySizeNote: string;
  website: string;
  socials: string;
  campaignNotes: string;
  teamTradeNotes: string;
}

export interface TradeRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: number;
  side: "buy" | "sell";
  actor: string;
  recipient: string;
  router: string | null;
  method: string | null;
  tokenRaw: string;
  wethRaw: string;
  priceBefore: string;
  priceAfter: string;
  immediateImpact: number | null;
  reserveTokenRaw: string;
  reserveWethRaw: string;
  category: WalletCategory;
  gasWei: string | null;
  actorIsContract: boolean;
  expectedOutRaw: string | null;
  actualToExpected: number | null;
}

export interface LiquidityEvent {
  kind: "mint" | "burn" | "transfer" | "sync";
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: number;
  actor: string;
  counterparty: string | null;
  tokenRaw: string;
  wethRaw: string;
  reserveTokenRaw: string | null;
  reserveWethRaw: string | null;
  note: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeWeth: number;
  buyWeth: number;
  sellWeth: number;
  trades: number;
  txHashes: string[];
}

export interface FlowPoint {
  time: number;
  reserveWeth: number;
  reserveToken: number;
  cumulativeNetWeth: number;
  uniqueBuyers: number;
  holders: number | null;
}

export interface CategoryVolume {
  category: WalletCategory;
  buyWethRaw: string;
  sellWethRaw: string;
  buyCount: number;
  sellCount: number;
  buyers: number;
  sellers: number;
}

export interface WalletProfile {
  address: string;
  category: WalletCategory;
  label: string;
  notes: string;
  isContract: boolean;
  confidence: number;
  reasons: string[];
  buyCount: number;
  sellCount: number;
  buyTokenRaw: string;
  sellTokenRaw: string;
  buyWethRaw: string;
  sellWethRaw: string;
  gasWei: string;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  remainingTokenRaw: string | null;
  realizedPnlWethRaw: string | null;
  realizedPnlStatus: "calculated" | "partial" | "not_calculable";
  realizedPnlNote: string;
  unrealizedTokenRaw: string | null;
  holdingSeconds: number | null;
  priceChangeAfterEntry: number | null;
  txHashes: string[];
  funding: FundingNote | null;
}

export interface FundingNote {
  funder: string | null;
  source: string;
  confidence: number;
  commonOwnership: "not_inferred" | "possible" | "not_assessed";
  detail: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  reason: string;
  confidence: number;
  confidenceLabel: Confidence;
}

export interface ScoreItem {
  id: string;
  label: string;
  score: number | null;
  status: "scored" | "not_assessed";
  formula: string;
  explanation: string;
  inputs: { name: string; value: string }[];
}

export interface Finding {
  id: string;
  title: string;
  summary: string;
  whatHappened: string;
  evidence: { label: string; value: string; txHash?: string }[];
  mechanism: string;
  effect: string;
  confidence: Confidence;
  unknown: string;
  whatWouldHelp: string;
}

export interface Recommendation {
  id: string;
  problem: string;
  evidence: string;
  rootCause: string;
  confidence: Confidence;
  action: string;
  verification: string;
  priority: "critical" | "high" | "medium" | "low";
  difficulty: string;
  cost: string;
  time: string;
  successMetrics: string;
  dependencies: string;
  expectedOutcome: string;
  category: "token_trust" | "liquidity_design" | "community" | "operations" | "risk";
}

export interface SellerRow {
  address: string;
  category: WalletCategory;
  label: string;
  tokenRaw: string;
  wethRaw: string;
  sellCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  largestTxHash: string;
  largestWethRaw: string;
  largestImpact: number | null;
  aroundAth: boolean;
  duringDrawdown: boolean;
}

export interface SimulationInput {
  initialWeth: number;
  initialTokens: number;
  tokenDecimals: number;
  buys: number[];
  sells: number[];
}

export interface SimulationStep {
  label: string;
  side: "seed" | "buy" | "sell";
  amountIn: number;
  amountOut: number;
  reserveWeth: number;
  reserveToken: number;
  priceWeth: number;
  impact: number | null;
}

export interface AnalysisReport {
  version: string;
  generatedAt: string;
  chainId: number;
  blockRange: { from: number | null; to: number | null };
  providers: string[];
  ethUsd: { price: number | null; source: string; asOf: string | null };
  completeness: ModuleStatus[];
  limitations: string[];
  pair: {
    address: string;
    factory: string | null;
    dex: "uniswap-v2" | "uniswap-v3" | "unknown";
    feeBps: number | null;
    token0: string;
    token1: string;
    quoteIsToken0: boolean;
  };
  token: {
    address: string;
    name: string | null;
    symbol: string;
    decimals: number;
    totalSupplyRaw: string | null;
  };
  quote: {
    address: string;
    symbol: string;
    decimals: number;
  };
  launchOperator: {
    address: string | null;
    evidence: string;
    confidence: Confidence;
  };
  launch: {
    deploymentTx: string | null;
    deploymentBlock: number | null;
    pairCreationTx: string | null;
    firstLiquidityTx: string | null;
    initialTokenRaw: string | null;
    initialWethRaw: string | null;
    initialPriceWeth: string | null;
    initialFdvWethRaw: string | null;
    initialFdvUsd: number | null;
    firstSwapTx: string | null;
    firstSwapTimestamp: number | null;
    firstBuyer: string | null;
    firstBuyerNote: string;
    firstMajorSellTx: string | null;
    ath: {
      timestamp: number | null;
      priceWeth: string | null;
      txHash: string | null;
      fdvWethRaw: string | null;
      fdvUsd: number | null;
    };
    maxDrawdown: {
      pct: number | null;
      fromTimestamp: number | null;
      toTimestamp: number | null;
      fromTx: string | null;
      toTx: string | null;
      fromPrice: string | null;
      toPrice: string | null;
    };
    finalTokenRaw: string | null;
    finalWethRaw: string | null;
    finalPriceWeth: string | null;
    windowSeconds: number | null;
  };
  summary: {
    swaps: number;
    buys: number;
    sells: number;
    uniqueBuyers: number;
    uniqueSellers: number;
    uniqueActors: number;
    buyWethRaw: string;
    sellWethRaw: string;
    volumeWethRaw: string;
    volumeUsdEstimate: number | null;
    buySellRatio: number | null;
    medianBuyWethRaw: string | null;
    averageBuyWethRaw: string | null;
    largestBuyWethRaw: string | null;
    largestBuyTx: string | null;
    tokenTaxMedian: number | null;
    tokenTaxNote: string;
  };
  categories: CategoryVolume[];
  external: {
    status: "not_provided" | "computed";
    message: string;
    knownExternalBuyers: number;
    knownExternalSellers: number;
    knownExternalBuyWethRaw: string;
    knownExternalSellWethRaw: string;
    knownExternalNetFlowRaw: string;
    knownExternalBuyVolumePct: number | null;
    knownExternalBuyerSharePct: number | null;
    unclassifiedBuyers: number;
    unclassifiedBuyVolumePct: number | null;
    assumption: null | {
      enabled: true;
      label: string;
      treatedAsTeamBuyers: number;
      treatedAsTeamBuyVolumePct: number | null;
      note: string;
    };
  };
  wallets: WalletProfile[];
  edges: GraphEdge[];
  sellers: SellerRow[];
  trades: TradeRow[];
  tokenTransfers: { from: string; to: string; raw: string; txHash: string; timestamp: number; logIndex: number }[];
  liquidityEvents: LiquidityEvent[];
  candles: Record<"1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "all", Candle[]>;
  series: FlowPoint[];
  flows: {
    initialWethRaw: string;
    buyInWethRaw: string;
    sellOutWethRaw: string;
    mintWethRaw: string;
    burnWethRaw: string;
    directInWethRaw: string;
    directOutWethRaw: string;
    expectedFinalWethRaw: string;
    syncFinalWethRaw: string | null;
    erc20WethRaw: string | null;
    discrepancyRaw: string | null;
    balanced: boolean | null;
    note: string;
    sankey: { source: string; target: string; weth: number }[];
  };
  liquidity: {
    lpSupplyRaw: string | null;
    burnedRaw: string | null;
    lockedInZeroRaw: string | null;
    operatorLpRaw: string | null;
    burnTx: string | null;
    burnAddress: string | null;
    removedViaBurn: boolean;
    explanation: string;
    currentWethRaw: string | null;
    currentTokenRaw: string | null;
    priceImpact: { sizeWeth: number; impactPct: number | null; outTokens: string | null; note: string }[];
    lock: { status: "burned" | "locked" | "unlocked" | "not_assessed"; detail: string; unlockTime: number | null };
  };
  security: {
    verified: boolean | null;
    verificationSource: string;
    bytecodeBytes: number | null;
    isProxy: boolean | null;
    owner: string | null;
    ownerNote: string;
    selectors: { signature: string; meaning: string; present: boolean }[];
    quoteCheck: string;
    honeypot: { status: "not_assessed" | "no_indication_at_sampled_block" | "sell_quote_failed" | "explained_by_empty_reserves"; detail: string };
    safetyRating: "not_assessed";
    safetyNote: string;
  };
  holders: {
    status: ModuleState;
    detail: string;
    peak: number | null;
    final: number | null;
    series: { time: number; holders: number }[];
  };
  perMinute: { time: number; buys: number; sells: number; buyWeth: number; sellWeth: number }[];
  scores: ScoreItem[];
  overall: { score: number | null; status: "scored" | "not_assessed"; disclaimer: string };
  worked: Finding[];
  failed: Finding[];
  recommendations: Recommendation[];
  narrative: {
    executive: string;
    timeline: string;
    organic: string;
    strengths: string;
    weaknesses: string;
    unanswered: string[];
    aiStatus: "not_configured" | "accepted" | "rejected" | "failed";
    aiNote: string;
    aiProse: string | null;
  };
  userContextEcho: LaunchContext;
}

export interface ProgressSnapshot {
  id: string;
  status: string;
  stage: string;
  stageIndex: number;
  progress: number;
  progressDetail: string;
  workCompleted: number;
  workTotal: number;
  indeterminate: boolean;
  error: string | null;
  stages: { index: number; label: string; state: "pending" | "active" | "done" }[];
}

export const STAGE_LABELS = [
  "Resolving token and pair",
  "Loading contract metadata",
  "Fetching launch transactions",
  "Decoding events",
  "Reconstructing reserve history",
  "Analyzing buyers and sellers",
  "Analyzing wallets",
  "Checking liquidity and security",
  "Calculating diagnostics",
  "Generating final report",
] as const;

export function emptyContext(): LaunchContext {
  return {
    externalWallets: [],
    teamWallets: [],
    botWallets: [],
    assumptionTreatUnlistedAsTeam: false,
    initialLiquidityNote: "",
    marketingSpendNote: "",
    launchTimingNote: "",
    communitySizeNote: "",
    website: "",
    socials: "",
    campaignNotes: "",
    teamTradeNotes: "",
  };
}
