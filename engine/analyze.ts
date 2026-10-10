import { decodeAbiParameters, encodeFunctionData, getAddress, parseAbiParameters, toFunctionSelector, type Hex } from "viem";
import { ANALYSIS_VERSION, STAGE_LABELS, emptyContext, type AnalysisReport, type Candle, type FlowPoint, type LaunchContext, type LiquidityEvent, type TradeRow } from "../shared/types.ts";
import { SELECTORS, TOPICS, WETH, ZERO, DEAD, balanceOfData, decodeAbiString, decodeRouterRecipient, decodeSignedWords, decodeWords, padTopic, topicToAddress } from "./decode.ts";
import { buildEconomics, dedupeWallets, normalizeAddress, type TokenTransfer } from "./economics.ts";
import { applyAssessment } from "./diagnosis.ts";
import { formatRaw, rawToNumber } from "./format.ts";
import { decimalFromRational, fdvRaw, priceRatio, relativeChange, v2AmountOut, v2PriceImpact } from "./math.ts";
import { parsePairUrl } from "./parseUrl.ts";
import { ProviderLimitation, RpcPool, getLogs, type EthLog } from "./rpc.ts";

export class CancelledError extends Error {
  constructor() {
    super("Analysis cancelled.");
    this.name = "CancelledError";
  }
}

export interface ProgressUpdate {
  stageIndex: number;
  detail: string;
  completed: number;
  total: number;
  indeterminate?: boolean;
}

export interface AnalyzeOptions {
  url: string;
  context?: Partial<LaunchContext>;
  rpcUrls?: string[];
  etherscanApiKey?: string;
  ai?: { baseUrl: string; apiKey: string; model: string } | null;
  onProgress?: (update: ProgressUpdate) => void;
  isCancelled?: () => boolean;
  fetchImpl?: typeof fetch;
}

function guard(options: AnalyzeOptions) {
  if (options.isCancelled?.()) throw new CancelledError();
}

function hexQty(value: bigint | number): string {
  return "0x" + BigInt(value).toString(16);
}

function addr(value: string): string {
  return getAddress(value);
}

async function readAddress(rpc: RpcPool, contract: string, data: string): Promise<string> {
  const raw = await rpc.call<string>("eth_call", [{ to: contract, data }, "latest"]);
  if (!raw || raw === "0x") throw new Error("Empty contract response.");
  return addr("0x" + raw.slice(-40));
}

async function readUint(rpc: RpcPool, contract: string, data: string, block: string | number = "latest"): Promise<bigint> {
  const tag = typeof block === "number" ? hexQty(block) : block;
  const raw = await rpc.call<string>("eth_call", [{ to: contract, data }, tag]);
  if (!raw || raw === "0x") return 0n;
  return BigInt(raw);
}

function rational(value: string): number {
  return decimalFromRational(value);
}

function bucketCandles(trades: TradeRow[], seconds: number, quoteDecimals: number): Candle[] {
  const map = new Map<number, Candle>();
  for (const trade of trades) {
    const time = seconds <= 0 ? trade.timestamp : Math.floor(trade.timestamp / seconds) * seconds;
    const price = rational(trade.priceAfter);
    const volume = rawToNumber(trade.wethRaw, quoteDecimals);
    const row = map.get(time);
    if (!row) {
      map.set(time, {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volumeWeth: volume,
        buyWeth: trade.side === "buy" ? volume : 0,
        sellWeth: trade.side === "sell" ? volume : 0,
        trades: 1,
        txHashes: [trade.txHash],
      });
    } else {
      row.high = Math.max(row.high, price);
      row.low = Math.min(row.low, price);
      row.close = price;
      row.volumeWeth += volume;
      if (trade.side === "buy") row.buyWeth += volume;
      else row.sellWeth += volume;
      row.trades += 1;
      if (row.txHashes.length < 12 && !row.txHashes.includes(trade.txHash)) row.txHashes.push(trade.txHash);
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function discoverLogs(rpc: RpcPool, pair: string, latest: number, options: AnalyzeOptions): Promise<{ logs: EthLog[]; truncated: boolean; detail: string }> {
  let cursor = latest;
  let span = 2_000;
  const collected: EthLog[] = [];
  let truncated = false;
  let detail = "Scanning recent blocks for pair events.";
  const floor = Math.max(0, latest - 1_500_000);
  while (cursor > floor) {
    guard(options);
    const from = Math.max(floor, cursor - span + 1);
    options.onProgress?.({ stageIndex: 2, detail: `Logs ${from}–${cursor}`, completed: latest - cursor, total: latest - floor });
    try {
      const chunk = await getLogs(rpc, { address: pair, fromBlock: from, toBlock: cursor });
      if (chunk.length) {
        collected.unshift(...chunk);
        const min = parseInt(chunk[0].blockNumber, 16);
        if (min > from) {
          detail = `Pair events begin at block ${min}.`;
          break;
        }
        cursor = from - 1;
      } else if (collected.length) {
        detail = "An empty block range sits before the first indexed event.";
        break;
      } else {
        cursor = from - 1;
        span = Math.min(span * 2, 20_000);
        detail = `No events yet. Continuing backward from ${cursor}.`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (collected.length) {
        truncated = true;
        detail = `Historical logs stopped early: ${message}`;
        break;
      }
      throw new ProviderLimitation(
        `The configured RPC could not return logs for this pair (${message}). Add an archive-capable RPC URL in Settings. No figures were substituted.`,
      );
    }
  }
  if (cursor <= floor && collected.length) {
    truncated = true;
    detail = "The lookback cap was reached before an empty range. Earlier events may exist.";
  }
  const seen = new Set<string>();
  const logs = collected.filter((log) => {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  logs.sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
  return { logs, truncated, detail };
}

export async function runAnalysis(options: AnalyzeOptions): Promise<AnalysisReport> {
  const context: LaunchContext = { ...emptyContext(), ...options.context };
  context.externalWallets = dedupeWallets(context.externalWallets ?? []);
  context.teamWallets = dedupeWallets(context.teamWallets ?? []);
  context.botWallets = dedupeWallets(context.botWallets ?? []);
  const rpc = new RpcPool(options.rpcUrls, options.fetchImpl);
  const progress = (stageIndex: number, detail: string, completed = 1, total = 1) => {
    guard(options);
    options.onProgress?.({ stageIndex, detail, completed, total, indeterminate: total <= 0 });
  };

  progress(0, "Parsing the pair URL");
  const parsed = parsePairUrl(options.url);
  if (parsed.chainId !== 1) {
    throw new Error("Only Ethereum mainnet (chain id 1) is reconstructed in this version. No figures were produced.");
  }
  const pair = parsed.pair;
  progress(0, "Reading pair tokens and reserves", 1, 2);
  let token0: string;
  let token1: string;
  try {
    token0 = await readAddress(rpc, pair, SELECTORS.token0);
    token1 = await readAddress(rpc, pair, SELECTORS.token1);
  } catch (error) {
    throw new Error(`This address did not answer as a Uniswap pair (${error instanceof Error ? error.message : error}).`);
  }
  let dex: AnalysisReport["pair"]["dex"] = "uniswap-v2";
  let reserves: { r0: bigint; r1: bigint } | null = null;
  try {
    const raw = await rpc.call<string>("eth_call", [{ to: pair, data: SELECTORS.getReserves }, "latest"]);
    const [r0, r1] = decodeWords(raw, 2);
    reserves = { r0, r1 };
  } catch {
    try {
      await rpc.call("eth_call", [{ to: pair, data: SELECTORS.slot0 }, "latest"]);
      throw new ProviderLimitation(
        "This pool exposes Uniswap V3 slot0. V3 swap decoding is implemented for tests, but a full V3 launch reconstruction (positions, NFT liquidity, burns) is not enabled. No figures were fabricated.",
      );
    } catch (error) {
      if (error instanceof ProviderLimitation) throw error;
      throw new Error("getReserves failed and the address is not a readable V3 pool. No figures were produced.");
    }
  }
  const factory = await readAddress(rpc, pair, SELECTORS.factory).catch(() => null);
  const quoteAddress = [token0, token1].find((item) => item.toLowerCase() === WETH.toLowerCase());
  if (!quoteAddress) {
    throw new Error("This pair is not quoted in WETH. LaunchForensics currently accounts WETH-quoted Uniswap V2 launches. No figures were produced.");
  }
  const tokenAddress = token0.toLowerCase() === quoteAddress.toLowerCase() ? token1 : token0;
  const quoteIsToken0 = token0.toLowerCase() === quoteAddress.toLowerCase();

  progress(1, "Loading token metadata");
  const [name, symbol, decimalsRaw, supplyRaw, quoteSymbolRaw, quoteDecimalsRaw] = await Promise.all([
    rpc.call<string>("eth_call", [{ to: tokenAddress, data: SELECTORS.name }, "latest"]).catch(() => "0x"),
    rpc.call<string>("eth_call", [{ to: tokenAddress, data: SELECTORS.symbol }, "latest"]).catch(() => "0x"),
    readUint(rpc, tokenAddress, SELECTORS.decimals).catch(() => 18n),
    readUint(rpc, tokenAddress, SELECTORS.totalSupply).catch(() => 0n),
    rpc.call<string>("eth_call", [{ to: quoteAddress, data: SELECTORS.symbol }, "latest"]).catch(() => "0x"),
    readUint(rpc, quoteAddress, SELECTORS.decimals).catch(() => 18n),
  ]);
  const tokenDecimals = Number(decimalsRaw);
  const quoteDecimals = Number(quoteDecimalsRaw);
  const tokenSymbol = decodeAbiString(symbol) || "TOKEN";
  const quoteSymbol = decodeAbiString(quoteSymbolRaw) || "WETH";
  const tokenName = decodeAbiString(name);

  progress(2, "Finding the first pair events", 0, 0);
  const latest = parseInt(await rpc.call<string>("eth_blockNumber", []), 16);
  const discovered = await discoverLogs(rpc, pair, latest, options);
  if (!discovered.logs.length) {
    throw new ProviderLimitation("No pair logs were found in the scanned range. Widen the RPC history or check the pair address. No figures were substituted.");
  }
  const logs = discovered.logs;
  const fromBlock = parseInt(logs[0].blockNumber, 16);
  const toBlock = parseInt(logs[logs.length - 1].blockNumber, 16);

  progress(3, "Loading transactions and block timestamps", 0, 1);
  const txHashes = [...new Set(logs.map((log) => log.transactionHash))];
  const blockNumbers = [...new Set(logs.map((log) => parseInt(log.blockNumber, 16)))];
  const txResults = await batched(rpc, txHashes.map((hash) => ({ method: "eth_getTransactionByHash", params: [hash] })), (done, total) => {
    progress(3, `Transactions ${done}/${total}`, done, total);
  });
  const blockResults = await batched(rpc, blockNumbers.map((block) => ({ method: "eth_getBlockByNumber", params: [hexQty(block), false] })), (done, total) => {
    progress(3, `Blocks ${done}/${total}`, done, total);
  });
  const receiptResults = await batched(rpc, txHashes.map((hash) => ({ method: "eth_getTransactionReceipt", params: [hash] })), (done, total) => {
    progress(3, `Receipts ${done}/${total}`, done, total);
  });

  const txs = new Map<string, { from: string; to: string | null; input: string; gasPrice: bigint }>();
  txHashes.forEach((hash, index) => {
    const tx = txResults[index] as { from?: string; to?: string | null; input?: string; gasPrice?: string } | null;
    if (!tx?.from) return;
    txs.set(hash.toLowerCase(), {
      from: addr(tx.from),
      to: tx.to ? addr(tx.to) : null,
      input: tx.input || "0x",
      gasPrice: BigInt(tx.gasPrice || "0x0"),
    });
  });
  const blocks = new Map<number, number>();
  blockNumbers.forEach((block, index) => {
    const row = blockResults[index] as { timestamp?: string } | null;
    if (row?.timestamp) blocks.set(block, parseInt(row.timestamp, 16));
  });
  const gasPaid = new Map<string, bigint>();
  let pairCreationTx: string | null = null;
  txHashes.forEach((hash, index) => {
    const receipt = receiptResults[index] as { gasUsed?: string; effectiveGasPrice?: string; logs?: EthLog[]; status?: string } | null;
    if (!receipt) return;
    const paid = BigInt(receipt.gasUsed || "0x0") * BigInt(receipt.effectiveGasPrice || "0x0");
    gasPaid.set(hash.toLowerCase(), paid || (BigInt(receipt.gasUsed || "0x0") * (txs.get(hash.toLowerCase())?.gasPrice ?? 0n)));
    for (const log of receipt.logs ?? []) {
      if (log.topics?.[0] === TOPICS.pairCreated) pairCreationTx = hash;
    }
  });

  progress(4, "Reconstructing reserves from Sync and Swap events");
  const ordered = logs
    .map((log) => ({ log, block: parseInt(log.blockNumber, 16), index: parseInt(log.logIndex, 16) }))
    .filter((item) => item.log.topics[0] === TOPICS.syncV2 || item.log.topics[0] === TOPICS.swapV2)
    .sort((a, b) => a.block - b.block || a.index - b.index);

  let reserve = { quote: 0n, token: 0n };
  let previous = { quote: 0n, token: 0n };
  const trades: TradeRow[] = [];
  const liquidityEvents: LiquidityEvent[] = [];
  let swapCount = 0;
  for (const item of ordered) {
    if (item.log.topics[0] === TOPICS.syncV2) {
      const [r0, r1] = decodeWords(item.log.data, 2);
      previous = reserve;
      reserve = quoteIsToken0 ? { quote: r0, token: r1 } : { quote: r1, token: r0 };
      continue;
    }
    swapCount += 1;
    const [a0in, a1in, a0out, a1out] = decodeWords(item.log.data, 4);
    const quoteIn = quoteIsToken0 ? a0in : a1in;
    const tokenIn = quoteIsToken0 ? a1in : a0in;
    const quoteOut = quoteIsToken0 ? a0out : a1out;
    const tokenOut = quoteIsToken0 ? a1out : a0out;
    const side: "buy" | "sell" | null = tokenOut > 0n && quoteIn > 0n ? "buy" : tokenIn > 0n && quoteOut > 0n ? "sell" : null;
    if (!side) continue;
    const tx = txs.get(item.log.transactionHash.toLowerCase());
    const routed = tx ? decodeRouterRecipient(tx.input) : null;
    const actor = tx?.from ?? topicToAddress(item.log.topics[1]);
    const pre = previous;
    const post = reserve;
    const priceBefore = priceRatio(pre.quote, pre.token, quoteDecimals, tokenDecimals);
    const priceAfter = priceRatio(post.quote, post.token, quoteDecimals, tokenDecimals);
    const impact = relativeChange(priceBefore, priceAfter);
    const amountIn = side === "buy" ? quoteIn : tokenIn;
    const reserveIn = side === "buy" ? pre.quote : pre.token;
    const reserveOut = side === "buy" ? pre.token : pre.quote;
    const actualOut = side === "buy" ? tokenOut : quoteOut;
    const expected = v2AmountOut(amountIn, reserveIn, reserveOut);
    const actualToExpected = expected > 0n ? Number((actualOut * 1_000_000n) / expected) / 1_000_000 : null;
    trades.push({
      txHash: item.log.transactionHash,
      logIndex: item.index,
      blockNumber: item.block,
      timestamp: blocks.get(item.block) ?? 0,
      side,
      actor: actor.toLowerCase(),
      recipient: (routed?.recipient ?? topicToAddress(item.log.topics[2])).toLowerCase(),
      router: tx?.to?.toLowerCase() ?? null,
      method: routed?.method ?? null,
      tokenRaw: (side === "buy" ? tokenOut : tokenIn).toString(),
      wethRaw: (side === "buy" ? quoteIn : quoteOut).toString(),
      priceBefore,
      priceAfter,
      immediateImpact: impact,
      reserveTokenRaw: post.token.toString(),
      reserveWethRaw: post.quote.toString(),
      category: "unclassified",
      gasWei: (gasPaid.get(item.log.transactionHash.toLowerCase()) ?? 0n).toString(),
      actorIsContract: false,
      expectedOutRaw: expected.toString(),
      actualToExpected,
    });
  }

  for (const log of logs) {
    const block = parseInt(log.blockNumber, 16);
    const index = parseInt(log.logIndex, 16);
    const timestamp = blocks.get(block) ?? 0;
    if (log.topics[0] === TOPICS.mintV2) {
      const [a0, a1] = decodeWords(log.data, 2);
      const tokenRaw = quoteIsToken0 ? a1 : a0;
      const wethRaw = quoteIsToken0 ? a0 : a1;
      liquidityEvents.push({
        kind: "mint",
        txHash: log.transactionHash,
        logIndex: index,
        blockNumber: block,
        timestamp,
        actor: (txs.get(log.transactionHash.toLowerCase())?.from ?? topicToAddress(log.topics[1])).toLowerCase(),
        counterparty: topicToAddress(log.topics[1]).toLowerCase(),
        tokenRaw: tokenRaw.toString(),
        wethRaw: wethRaw.toString(),
        reserveTokenRaw: null,
        reserveWethRaw: null,
        note: `Mint deposited ${formatRaw(tokenRaw, tokenDecimals, 4)} ${tokenSymbol} and ${formatRaw(wethRaw, quoteDecimals, 8)} ${quoteSymbol}.`,
      });
    } else if (log.topics[0] === TOPICS.burnV2) {
      const [a0, a1] = decodeWords(log.data, 2);
      const tokenRaw = quoteIsToken0 ? a1 : a0;
      const wethRaw = quoteIsToken0 ? a0 : a1;
      liquidityEvents.push({
        kind: "burn",
        txHash: log.transactionHash,
        logIndex: index,
        blockNumber: block,
        timestamp,
        actor: (txs.get(log.transactionHash.toLowerCase())?.from ?? topicToAddress(log.topics[1])).toLowerCase(),
        counterparty: topicToAddress(log.topics[2]).toLowerCase(),
        tokenRaw: tokenRaw.toString(),
        wethRaw: wethRaw.toString(),
        reserveTokenRaw: null,
        reserveWethRaw: null,
        note: `Burn removed ${formatRaw(tokenRaw, tokenDecimals, 4)} ${tokenSymbol} and ${formatRaw(wethRaw, quoteDecimals, 8)} ${quoteSymbol}.`,
      });
    } else if (log.topics[0] === TOPICS.transfer) {
      const from = topicToAddress(log.topics[1]);
      const to = topicToAddress(log.topics[2]);
      const value = decodeWords(log.data, 1)[0];
      liquidityEvents.push({
        kind: "transfer",
        txHash: log.transactionHash,
        logIndex: index,
        blockNumber: block,
        timestamp,
        actor: from.toLowerCase(),
        counterparty: to.toLowerCase(),
        tokenRaw: value.toString(),
        wethRaw: "0",
        reserveTokenRaw: null,
        reserveWethRaw: null,
        note: `LP transfer of ${formatRaw(value, 18, 6)} from ${from} to ${to}.`,
      });
    }
  }

  progress(5, "Classifying buys and sells");
  const actors = [...new Set(trades.map((trade) => trade.actor))];
  const codes = await batched(rpc, actors.map((actor) => ({ method: "eth_getCode", params: [getAddress(actor), "latest"] })), (done, total) => {
    progress(6, `Contract checks ${done}/${total}`, done, total);
  });
  actors.forEach((actor, index) => {
    const code = String(codes[index] || "0x");
    const isContract = code !== "0x" && code !== "0x0";
    for (const trade of trades) if (trade.actor === actor) trade.actorIsContract = isContract;
  });

  progress(6, "Reading token and WETH transfers");
  let tokenTransfers: TokenTransfer[] = [];
  let holderState: AnalysisReport["holders"] = { status: "not_assessed", detail: "Token transfer logs were not loaded.", peak: null, final: null, series: [] };
  let directIn = 0n;
  let directOut = 0n;
  try {
    const [tokenLogs, wethToPair, wethFromPair] = await Promise.all([
      getLogs(rpc, { address: tokenAddress, topics: [TOPICS.transfer], fromBlock: Math.max(0, fromBlock - 2_000), toBlock }),
      getLogs(rpc, { address: quoteAddress, topics: [TOPICS.transfer, null, padTopic(pair)], fromBlock, toBlock }),
      getLogs(rpc, { address: quoteAddress, topics: [TOPICS.transfer, padTopic(pair)], fromBlock, toBlock }),
    ]);
    tokenTransfers = tokenLogs.map((log) => ({
      from: topicToAddress(log.topics[1]).toLowerCase(),
      to: topicToAddress(log.topics[2]).toLowerCase(),
      raw: decodeWords(log.data, 1)[0].toString(),
      txHash: log.transactionHash,
      timestamp: blocks.get(parseInt(log.blockNumber, 16)) ?? 0,
      logIndex: parseInt(log.logIndex, 16),
    }));
    holderState = holderSeries(tokenTransfers, pair.toLowerCase());
    const wethIn = wethToPair.reduce((sum, log) => sum + decodeWords(log.data, 1)[0], 0n);
    const wethOut = wethFromPair.reduce((sum, log) => sum + decodeWords(log.data, 1)[0], 0n);
    const mintQuote = liquidityEvents.filter((event) => event.kind === "mint").reduce((sum, event) => sum + BigInt(event.wethRaw), 0n);
    const burnQuote = liquidityEvents.filter((event) => event.kind === "burn").reduce((sum, event) => sum + BigInt(event.wethRaw), 0n);
    const buyQuote = trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + BigInt(trade.wethRaw), 0n);
    const sellQuote = trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + BigInt(trade.wethRaw), 0n);
    const inGap = wethIn - mintQuote - buyQuote;
    const outGap = wethOut - burnQuote - sellQuote;
    directIn = inGap > 0n ? inGap : 0n;
    directOut = outGap > 0n ? outGap : 0n;
  } catch (error) {
    holderState = {
      status: "partial",
      detail: `Token or WETH transfer logs could not be fully read (${error instanceof Error ? error.message : error}). Holder counts and direct-transfer gaps are incomplete.`,
      peak: null,
      final: null,
      series: [],
    };
  }

  const firstMint = liquidityEvents.find((event) => event.kind === "mint") ?? null;
  const operatorAddress = firstMint?.actor ?? null;

  let peakPrice = 0;
  let peakTx: string | null = null;
  let peakTime: number | null = null;
  let peakFdv: bigint | null = null;
  let runPeak = 0;
  let runPeakTx: string | null = null;
  let runPeakTime: number | null = null;
  let maxDd = 0;
  let ddFromT: number | null = null;
  let ddToT: number | null = null;
  let ddFromTx: string | null = null;
  let ddToTx: string | null = null;
  let ddFromP = "";
  let ddToP = "";
  for (const trade of trades) {
    const price = rational(trade.priceAfter);
    if (price >= peakPrice) {
      peakPrice = price;
      peakTx = trade.txHash;
      peakTime = trade.timestamp;
      peakFdv = supplyRaw > 0n ? fdvRaw(BigInt(trade.reserveWethRaw), BigInt(trade.reserveTokenRaw), supplyRaw) : null;
    }
    if (price >= runPeak) {
      runPeak = price;
      runPeakTx = trade.txHash;
      runPeakTime = trade.timestamp;
    } else if (runPeak > 0) {
      const dd = (runPeak - price) / runPeak;
      if (dd > maxDd) {
        maxDd = dd;
        ddFromT = runPeakTime;
        ddToT = trade.timestamp;
        ddFromTx = runPeakTx;
        ddToTx = trade.txHash;
        ddFromP = String(runPeak);
        ddToP = String(price);
      }
    }
  }

  const priced = buildEconomics({
    trades,
    context,
    transfers: tokenTransfers,
    operator: operatorAddress,
    pool: pair.toLowerCase(),
    finalPrice: trades.at(-1)?.priceAfter ?? null,
    athTimestamp: peakTime,
    drawdownFrom: ddFromT,
    drawdownTo: ddToT,
    endTimestamp: blocks.get(toBlock) ?? Math.floor(Date.now() / 1000),
  });

  progress(7, "Checking LP custody and contract disclosure");
  const [lpSupply, burned, zeroLp, operatorLp, erc20Quote, erc20Token, bytecode, ownerRaw, proxySlot] = await Promise.all([
    readUint(rpc, pair, SELECTORS.totalSupply).catch(() => 0n),
    readUint(rpc, pair, balanceOfData(DEAD)).catch(() => 0n),
    readUint(rpc, pair, balanceOfData(ZERO)).catch(() => 0n),
    operatorAddress ? readUint(rpc, pair, balanceOfData(getAddress(operatorAddress))).catch(() => 0n) : Promise.resolve(0n),
    readUint(rpc, quoteAddress, balanceOfData(pair)).catch(() => null as unknown as bigint),
    readUint(rpc, tokenAddress, balanceOfData(pair)).catch(() => null as unknown as bigint),
    rpc.call<string>("eth_getCode", [tokenAddress, "latest"]).catch(() => "0x"),
    rpc.call<string>("eth_call", [{ to: tokenAddress, data: SELECTORS.owner }, "latest"]).catch(() => ""),
    rpc.call<string>("eth_getStorageAt", [tokenAddress, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"]).catch(() => "0x0"),
  ]);
  const burnTransfer = liquidityEvents.find((event) => event.kind === "transfer" && (event.counterparty === DEAD.toLowerCase() || event.counterparty === ZERO.toLowerCase()));
  const removedViaBurn = liquidityEvents.some((event) => event.kind === "burn");
  const burnedEnough = lpSupply > 0n && burned + zeroLp + 1000n >= lpSupply;
  const lockStatus = burned > 0n && burnedEnough ? "burned" : zeroLp > 1000n ? "locked" : lpSupply === 0n ? "not_assessed" : "unlocked";

  const deployment = await findDeployment(rpc, tokenAddress, fromBlock).catch(() => null);
  const verification = await verifySource(tokenAddress, options.etherscanApiKey, options.fetchImpl);
  const selectors = scanSelectors(bytecode);
  const quoteCheck = await quoteAtHealthyBlock(rpc, trades, tokenAddress, quoteAddress, quoteIsToken0);

  const ratios = priced.trades.map((trade) => trade.actualToExpected).filter((value): value is number => value !== null && value > 0);
  ratios.sort((a, b) => a - b);
  const taxMedian = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;

  const ethUsd = await loadEthUsd(peakTime, firstMint?.timestamp ?? null, options.fetchImpl);
  const initialWeth = firstMint ? BigInt(firstMint.wethRaw) : null;
  const initialToken = firstMint ? BigInt(firstMint.tokenRaw) : null;
  const initialFdv = initialWeth !== null && initialToken && supplyRaw > 0n ? fdvRaw(initialWeth, initialToken, supplyRaw) : null;
  const finalTrade = priced.trades.at(-1) ?? null;
  const buyWeth = priced.trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + BigInt(trade.wethRaw), 0n);
  const sellWeth = priced.trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + BigInt(trade.wethRaw), 0n);
  const mintWeth = liquidityEvents.filter((event) => event.kind === "mint").reduce((sum, event) => sum + BigInt(event.wethRaw), 0n);
  const burnWeth = liquidityEvents.filter((event) => event.kind === "burn").reduce((sum, event) => sum + BigInt(event.wethRaw), 0n);
  const expectedFinal = mintWeth + buyWeth + directIn - burnWeth - sellWeth - directOut;
  const syncFinal = finalTrade ? BigInt(finalTrade.reserveWethRaw) : reserves ? (quoteIsToken0 ? reserves.r0 : reserves.r1) : null;
  const discrepancy = syncFinal === null ? null : expectedFinal - syncFinal;
  const balanced = discrepancy !== null && discrepancy <= 2n && discrepancy >= -2n && (erc20Quote === null || (syncFinal !== null && erc20Quote - syncFinal <= 2n && syncFinal - erc20Quote <= 2n));

  const firstBuy = priced.trades.find((trade) => trade.side === "buy" && trade.actor !== operatorAddress);
  const firstMajor = priced.trades.find((trade, index) => {
    if (trade.side !== "sell") return false;
    const pre = index === 0 ? (initialWeth ?? 0n) : BigInt(priced.trades[index - 1].reserveWethRaw);
    return BigInt(trade.wethRaw) >= 10n ** 17n || (pre > 0n && BigInt(trade.wethRaw) * 5n >= pre);
  });

  const quoteDec = quoteDecimals;
  const sizes = [0.05, 0.1, 0.5, 1];
  const finalQuoteReserve = syncFinal ?? 0n;
  const finalTokenReserve = finalTrade ? BigInt(finalTrade.reserveTokenRaw) : quoteIsToken0 ? reserves!.r1 : reserves!.r0;
  const priceImpact = sizes.map((size) => {
    const amount = decimalToRaw(size, quoteDec);
    if (finalQuoteReserve < amount || finalTokenReserve === 0n) {
      return { sizeWeth: size, impactPct: null, outTokens: null, note: `The pool's ${quoteSymbol} reserve cannot clear a ${size} ${quoteSymbol} buy.` };
    }
    const out = v2AmountOut(amount, finalQuoteReserve, finalTokenReserve);
    const impact = v2PriceImpact(amount, finalQuoteReserve, finalTokenReserve);
    return {
      sizeWeth: size,
      impactPct: impact === null ? null : impact * 100,
      outTokens: formatRaw(out, tokenDecimals, 4),
      note: "Constant-product quote with a 0.30% fee, using the latest indexed reserves. This is a simulation of the current pool, not a historical fill.",
    };
  });

  const span = priced.trades.length > 1 ? priced.trades[priced.trades.length - 1].timestamp - priced.trades[0].timestamp : 0;
  const allBucket = Math.max(60, Math.ceil((span || 60) / 120));
  const candles = {
    "1m": bucketCandles(priced.trades, 60, quoteDec),
    "5m": bucketCandles(priced.trades, 300, quoteDec),
    "15m": bucketCandles(priced.trades, 900, quoteDec),
    "1h": bucketCandles(priced.trades, 3600, quoteDec),
    "4h": bucketCandles(priced.trades, 14400, quoteDec),
    "1d": bucketCandles(priced.trades, 86400, quoteDec),
    all: bucketCandles(priced.trades, allBucket, quoteDec),
  };

  const buyerSet = new Set<string>();
  let runningNet = 0n;
  const series: FlowPoint[] = [];
  const initialRaw = initialWeth ?? 0n;
  for (const trade of priced.trades) {
    if (trade.side === "buy") {
      buyerSet.add(trade.actor);
      runningNet += BigInt(trade.wethRaw);
    } else runningNet -= BigInt(trade.wethRaw);
    series.push({
      time: trade.timestamp,
      reserveWeth: rawToNumber(trade.reserveWethRaw, quoteDec),
      reserveToken: rawToNumber(trade.reserveTokenRaw, tokenDecimals),
      cumulativeNetWeth: rawToNumber((initialRaw + runningNet).toString(), quoteDec),
      uniqueBuyers: buyerSet.size,
      holders: null,
    });
  }

  const perMinuteMap = new Map<number, { time: number; buys: number; sells: number; buyWeth: number; sellWeth: number }>();
  for (const trade of priced.trades) {
    const time = Math.floor(trade.timestamp / 60) * 60;
    const row = perMinuteMap.get(time) ?? { time, buys: 0, sells: 0, buyWeth: 0, sellWeth: 0 };
    const amount = rawToNumber(trade.wethRaw, quoteDec);
    if (trade.side === "buy") {
      row.buys += 1;
      row.buyWeth += amount;
    } else {
      row.sells += 1;
      row.sellWeth += amount;
    }
    perMinuteMap.set(time, row);
  }

  const sankey = buildSankey(priced.categories, mintWeth, finalQuoteReserve, burnWeth, directIn, directOut, quoteDec);
  const limitations: string[] = [];
  if (discovered.truncated) limitations.push(discovered.detail);
  if (!deployment) limitations.push("The token creation transaction was not recovered from the scanned blocks. The launch operator is the sender of the first liquidity transaction, which is not automatic proof of contract creation.");
  if (!verification.verified) limitations.push("Token source is unverified, so privileged functions cannot be confirmed from a source match. Safety is not assessed.");
  if (holderState.status !== "complete") limitations.push(holderState.detail);
  if (!ethUsd.price) limitations.push("ETH/USD was unavailable. WETH amounts stay exact; USD figures are omitted.");
  limitations.push("Sending addresses are not people. One operator can control many wallets.");
  limitations.push("Realized PnL uses average cost on pool trades only. Gas is reported separately and is not subtracted from that figure.");
  limitations.push("Pool outflows are quote tokens leaving the pair. They are profit only after a wallet's own cost basis is reconstructed.");

  const usd = (raw: bigint | null) => (raw !== null && ethUsd.price ? rawToNumber(raw.toString(), quoteDec) * ethUsd.price : null);
  const volumeWeth = buyWeth + sellWeth;
  const largestBuy = priced.trades.filter((trade) => trade.side === "buy").sort((a, b) => (BigInt(a.wethRaw) > BigInt(b.wethRaw) ? -1 : 1))[0];

  const completeness: AnalysisReport["completeness"] = [
    { id: "pair", label: "Pair resolution", state: "complete", detail: `${dex} ${tokenSymbol}/${quoteSymbol}` },
    { id: "logs", label: "Event index", state: discovered.truncated ? "partial" : "complete", detail: discovered.detail },
    { id: "reserves", label: "Reserve reconstruction", state: priced.trades.length ? "complete" : "partial", detail: `${priced.trades.length} classified swaps from ${swapCount} swap logs.` },
    { id: "holders", label: "Holder replay", state: holderState.status, detail: holderState.detail },
    { id: "security", label: "Contract disclosure", state: verification.verified ? "complete" : "partial", detail: verification.source },
    { id: "organic", label: "Known external participation", state: context.externalWallets.length ? "complete" : "not_assessed", detail: context.externalWallets.length ? "Computed from the supplied list." : "No known-external wallets were supplied." },
  ];

  progress(8, "Scoring the launch from the calculated evidence");
  const honeypot = finalQuoteReserve < 10n ** 15n
    ? { status: "explained_by_empty_reserves" as const, detail: `The ending ${quoteSymbol} reserve is ${formatRaw(finalQuoteReserve, quoteDec, 12)}. A near-zero sell quote at the end is explained by that reserve, not by a honeypot test. ${quoteCheck}` }
    : quoteCheck.includes("both directions")
      ? { status: "no_indication_at_sampled_block" as const, detail: quoteCheck }
      : { status: "not_assessed" as const, detail: quoteCheck };

  let report: AnalysisReport = {
    version: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    chainId: 1,
    blockRange: { from: fromBlock, to: toBlock },
    providers: rpc.urls,
    ethUsd,
    completeness,
    limitations,
    pair: { address: pair, factory, dex, feeBps: 30, token0, token1, quoteIsToken0 },
    token: { address: tokenAddress, name: tokenName, symbol: tokenSymbol, decimals: tokenDecimals, totalSupplyRaw: supplyRaw.toString() },
    quote: { address: quoteAddress, symbol: quoteSymbol, decimals: quoteDec },
    launchOperator: {
      address: operatorAddress,
      evidence: operatorAddress
        ? `This address is the transaction sender on the first Mint (${firstMint?.txHash}).`
        : "No Mint event was indexed, so no launch operator was assigned.",
      confidence: operatorAddress ? "confirmed" : "unverified",
    },
    launch: {
      deploymentTx: deployment?.tx ?? null,
      deploymentBlock: deployment?.block ?? null,
      pairCreationTx,
      firstLiquidityTx: firstMint?.txHash ?? null,
      initialTokenRaw: initialToken?.toString() ?? null,
      initialWethRaw: initialWeth?.toString() ?? null,
      initialPriceWeth: initialWeth !== null && initialToken ? priceRatio(initialWeth, initialToken, quoteDec, tokenDecimals) : null,
      initialFdvWethRaw: initialFdv?.toString() ?? null,
      initialFdvUsd: usd(initialFdv),
      firstSwapTx: priced.trades[0]?.txHash ?? null,
      firstSwapTimestamp: priced.trades[0]?.timestamp ?? null,
      firstBuyer: firstBuy?.actor ?? null,
      firstBuyerNote: firstBuy
        ? `${firstBuy.actor} is the first buy sender other than the liquidity sender. That does not establish an independent person.`
        : "No buy from an address other than the liquidity sender was indexed.",
      firstMajorSellTx: firstMajor?.txHash ?? null,
      ath: {
        timestamp: peakTime,
        priceWeth: peakTx ? priced.trades.find((trade) => trade.txHash === peakTx)?.priceAfter ?? null : null,
        txHash: peakTx,
        fdvWethRaw: peakFdv?.toString() ?? null,
        fdvUsd: usd(peakFdv),
      },
      maxDrawdown: {
        pct: priced.trades.length ? maxDd : null,
        fromTimestamp: ddFromT,
        toTimestamp: ddToT,
        fromTx: ddFromTx,
        toTx: ddToTx,
        fromPrice: ddFromP || null,
        toPrice: ddToP || null,
      },
      finalTokenRaw: finalTokenReserve.toString(),
      finalWethRaw: finalQuoteReserve.toString(),
      finalPriceWeth: finalTrade?.priceAfter ?? null,
      windowSeconds: span || null,
    },
    summary: {
      swaps: priced.trades.length,
      buys: priced.trades.filter((trade) => trade.side === "buy").length,
      sells: priced.trades.filter((trade) => trade.side === "sell").length,
      uniqueBuyers: priced.uniqueBuyers,
      uniqueSellers: priced.uniqueSellers,
      uniqueActors: new Set(priced.trades.map((trade) => trade.actor)).size,
      buyWethRaw: buyWeth.toString(),
      sellWethRaw: sellWeth.toString(),
      volumeWethRaw: volumeWeth.toString(),
      volumeUsdEstimate: usd(volumeWeth),
      buySellRatio: sellWeth > 0n ? Number((buyWeth * 1000n) / sellWeth) / 1000 : null,
      medianBuyWethRaw: priced.medianBuy,
      averageBuyWethRaw: priced.averageBuy,
      largestBuyWethRaw: largestBuy?.wethRaw ?? null,
      largestBuyTx: largestBuy?.txHash ?? null,
      tokenTaxMedian: taxMedian,
      tokenTaxNote: taxMedian === null
        ? "Expected-output comparison was not available."
        : `Median actual output divided by the Uniswap V2 0.30% quote is ${taxMedian.toFixed(4)} across ${ratios.length} swaps. Values near 1 match the pair formula.`,
    },
    categories: priced.categories,
    external: priced.external,
    wallets: priced.wallets,
    edges: priced.edges,
    sellers: priced.sellers,
    trades: priced.trades,
    tokenTransfers: tokenTransfers.slice(0, 8000),
    liquidityEvents,
    candles,
    series,
    flows: {
      initialWethRaw: (initialWeth ?? 0n).toString(),
      buyInWethRaw: buyWeth.toString(),
      sellOutWethRaw: sellWeth.toString(),
      mintWethRaw: mintWeth.toString(),
      burnWethRaw: burnWeth.toString(),
      directInWethRaw: directIn.toString(),
      directOutWethRaw: directOut.toString(),
      expectedFinalWethRaw: expectedFinal.toString(),
      syncFinalWethRaw: syncFinal?.toString() ?? null,
      erc20WethRaw: erc20Quote === null ? null : erc20Quote.toString(),
      discrepancyRaw: discrepancy?.toString() ?? null,
      balanced,
      note: balanced
        ? `Ending ${quoteSymbol} equals mints plus buy inflows plus direct inflows, minus burns, sells, and direct outflows, within 2 wei. The 0.30% fee stays inside amount-in, so it is not a separate term. ERC-20 balance and the last Sync agree.`
        : `Expected ending ${quoteSymbol} and the last Sync differ by ${discrepancy === null ? "an unknown amount" : formatRaw(discrepancy, quoteDec, 8)}. Direct transfers or a truncated log range can cause that gap.`,
      sankey,
    },
    liquidity: {
      lpSupplyRaw: lpSupply.toString(),
      burnedRaw: burned.toString(),
      lockedInZeroRaw: zeroLp.toString(),
      operatorLpRaw: operatorLp.toString(),
      burnTx: burnTransfer?.txHash ?? null,
      burnAddress: burned > 0n ? DEAD : null,
      removedViaBurn,
      explanation: removedViaBurn
        ? "At least one Burn event removed liquidity. Burned LP and reserve changes are both listed in the timeline."
        : "LP tokens at the burn address cannot call removeLiquidity. The quote reserve can still fall when traders swap the base token in and take quote tokens out. That path is a sell, not an LP removal.",
      currentWethRaw: finalQuoteReserve.toString(),
      currentTokenRaw: finalTokenReserve.toString(),
      priceImpact,
      lock: {
        status: lockStatus,
        detail: lockStatus === "burned"
          ? `Burn address holds ${formatRaw(burned, 18, 6)} LP. Zero address holds ${formatRaw(zeroLp, 18, 6)}, including the Uniswap V2 minimum liquidity when that transfer is the 1000 wei lock.`
          : lockStatus === "unlocked"
            ? "LP supply is not fully at the burn or zero address."
            : "LP custody could not be fully scored.",
        unlockTime: null,
      },
    },
    security: {
      verified: verification.verified,
      verificationSource: verification.source,
      bytecodeBytes: bytecode && bytecode !== "0x" ? (bytecode.length - 2) / 2 : 0,
      isProxy: BigInt(proxySlot || "0x0") !== 0n,
      owner: ownerRaw && ownerRaw !== "0x" ? addr("0x" + ownerRaw.slice(-40)).toLowerCase() : null,
      ownerNote: ownerRaw
        ? "owner() returned a value. Without verified source, a zero result is not proof that every privileged function is gone."
        : "owner() reverted or returned empty data.",
      selectors,
      quoteCheck,
      honeypot,
      safetyRating: "not_assessed",
      safetyNote: verification.verified
        ? "Source is verified. This report still does not issue a safety rating; read the permissions yourself."
        : "Safety is Not Assessed because the source is not verified. Selector hits in bytecode are hints and can be false matches.",
    },
    holders: holderState,
    perMinute: [...perMinuteMap.values()].sort((a, b) => a.time - b.time),
    scores: [],
    overall: { score: null, status: "not_assessed", disclaimer: "" },
    worked: [],
    failed: [],
    recommendations: [],
    narrative: {
      executive: "",
      timeline: "",
      organic: "",
      strengths: "",
      weaknesses: "",
      unanswered: [],
      aiStatus: "not_configured",
      aiNote: "",
      aiProse: null,
    },
    userContextEcho: context,
  };

  if (deployment?.tx && deployment.from && operatorAddress && deployment.from.toLowerCase() === operatorAddress) {
    report.launchOperator.evidence += ` The same address created the token in ${deployment.tx}.`;
  }

  progress(9, "Writing the evidence narrative");
  report = applyAssessment(report);
  report = await maybeAi(report, options);
  progress(9, "Report ready", 1, 1);
  return report;
}

export function reclassifyReport(report: AnalysisReport, context: LaunchContext): AnalysisReport {
  const normalized: LaunchContext = {
    ...emptyContext(),
    ...context,
    externalWallets: dedupeWallets(context.externalWallets ?? []),
    teamWallets: dedupeWallets(context.teamWallets ?? []),
    botWallets: dedupeWallets(context.botWallets ?? []),
  };
  const priced = buildEconomics({
    trades: report.trades,
    context: normalized,
    transfers: report.tokenTransfers,
    operator: report.launchOperator.address,
    pool: report.pair.address.toLowerCase(),
    finalPrice: report.launch.finalPriceWeth,
    athTimestamp: report.launch.ath.timestamp,
    drawdownFrom: report.launch.maxDrawdown.fromTimestamp,
    drawdownTo: report.launch.maxDrawdown.toTimestamp,
    endTimestamp: report.launch.windowSeconds && report.launch.firstSwapTimestamp ? report.launch.firstSwapTimestamp + report.launch.windowSeconds : report.trades.at(-1)?.timestamp ?? 0,
  });
  const next: AnalysisReport = {
    ...report,
    generatedAt: new Date().toISOString(),
    trades: priced.trades,
    wallets: priced.wallets,
    categories: priced.categories,
    external: priced.external,
    sellers: priced.sellers,
    edges: priced.edges,
    userContextEcho: normalized,
    summary: { ...report.summary, uniqueBuyers: priced.uniqueBuyers, uniqueSellers: priced.uniqueSellers, medianBuyWethRaw: priced.medianBuy, averageBuyWethRaw: priced.averageBuy },
    completeness: report.completeness.map((item) => item.id === "organic"
      ? { ...item, state: normalized.externalWallets.length ? "complete" : "not_assessed", detail: normalized.externalWallets.length ? "Recomputed from the edited list." : "No known-external wallets were supplied." }
      : item),
    flows: {
      ...report.flows,
      sankey: buildSankey(
        priced.categories,
        BigInt(report.flows.initialWethRaw),
        BigInt(report.flows.syncFinalWethRaw || "0"),
        BigInt(report.flows.burnWethRaw),
        BigInt(report.flows.directInWethRaw),
        BigInt(report.flows.directOutWethRaw),
        report.quote.decimals,
      ),
    },
  };
  return applyAssessment(next);
}

function buildSankey(
  categories: AnalysisReport["categories"],
  initial: bigint,
  finalReserve: bigint,
  burn: bigint,
  directIn: bigint,
  directOut: bigint,
  decimals: number,
): { source: string; target: string; weth: number }[] {
  const links: { source: string; target: string; weth: number }[] = [];
  const add = (source: string, target: string, raw: bigint) => {
    const weth = rawToNumber(raw.toString(), decimals);
    if (weth > 0) links.push({ source, target, weth });
  };
  add("Liquidity added", "Pool", initial);
  add("Direct transfers in", "Pool", directIn);
  for (const row of categories) add(`Buys · ${labelOf(row.category)}`, "Pool", BigInt(row.buyWethRaw));
  for (const row of categories) add("Pool", `Sells · ${labelOf(row.category)}`, BigInt(row.sellWethRaw));
  add("Pool", "LP withdrawals", burn);
  add("Pool", "Direct transfers out", directOut);
  add("Pool", "Ending reserve", finalReserve);
  return links;
}

function labelOf(category: string): string {
  switch (category) {
    case "known_external":
      return "known external";
    case "confirmed_team":
      return "confirmed team";
    case "suspected_related":
      return "suspected related";
    case "known_contract":
      return "contracts";
    default:
      return "unclassified";
  }
}

function holderSeries(transfers: TokenTransfer[], pool: string): AnalysisReport["holders"] {
  const balances = new Map<string, bigint>();
  const skip = new Set([pool, ZERO.toLowerCase(), DEAD.toLowerCase()]);
  let holders = 0;
  let peak = 0;
  const series: { time: number; holders: number }[] = [];
  const sorted = [...transfers].sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);
  for (const transfer of sorted) {
    for (const [address, delta] of [[transfer.from, -BigInt(transfer.raw)], [transfer.to, BigInt(transfer.raw)]] as const) {
      if (skip.has(address)) continue;
      const next = (balances.get(address) ?? 0n) + delta;
      const was = (balances.get(address) ?? 0n) > 0n;
      const now = next > 0n;
      balances.set(address, next);
      if (was && !now) holders -= 1;
      if (!was && now) holders += 1;
    }
    if (series.length < 500) series.push({ time: transfer.timestamp, holders });
    peak = Math.max(peak, holders);
  }
  const negative = [...balances.values()].some((value) => value < 0n);
  if (negative) {
    return {
      status: "partial",
      detail: "Token transfer replay produced a negative balance, so the indexed window does not contain every mint. Holder counts and wallet inventory are incomplete.",
      peak: null,
      final: null,
      series: [],
    };
  }
  return {
    status: "complete",
    detail: "Holders are addresses with a positive replayed balance, excluding the pair, the zero address, and the burn address. Addresses are not people.",
    peak,
    final: holders,
    series,
  };
}

async function batched(rpc: RpcPool, calls: { method: string; params: unknown[] }[], onProgress: (done: number, total: number) => void): Promise<unknown[]> {
  const out: unknown[] = [];
  const size = 20;
  for (let index = 0; index < calls.length; index += size) {
    const chunk = calls.slice(index, index + size);
    const rows = await rpc.batch(chunk, size);
    out.push(...rows);
    onProgress(Math.min(calls.length, index + chunk.length), calls.length);
  }
  return out;
}

async function findDeployment(rpc: RpcPool, token: string, known: number): Promise<{ block: number; tx: string; from: string } | null> {
  const hasCode = async (block: number) => {
    const code = await rpc.call<string>("eth_getCode", [token, hexQty(block)]);
    return Boolean(code && code !== "0x" && code !== "0x0");
  };
  let high = known;
  let low = Math.max(0, known - 30);
  try {
    if (!(await hasCode(high))) return null;
    for (const gap of [30, 300, 3000, 30000]) {
      const probe = Math.max(0, known - gap);
      if (await hasCode(probe)) low = Math.max(0, probe - 1);
      else {
        low = probe;
        break;
      }
    }
  } catch {
    return null;
  }
  if (await hasCode(low).catch(() => true)) return null;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await hasCode(mid).catch(() => true)) high = mid;
    else low = mid;
  }
  const block = (await rpc.call<{ transactions: { hash: string; from: string; to: string | null }[] }>("eth_getBlockByNumber", [hexQty(high), true]));
  for (const tx of block?.transactions ?? []) {
    if (tx.to) continue;
    const receipt = await rpc.call<{ contractAddress?: string | null }>("eth_getTransactionReceipt", [tx.hash]);
    if (receipt.contractAddress && receipt.contractAddress.toLowerCase() === token.toLowerCase()) {
      return { block: high, tx: tx.hash, from: tx.from };
    }
  }
  return null;
}

async function verifySource(token: string, etherscanKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ verified: boolean; source: string }> {
  try {
    const response = await fetchImpl(`https://sourcify.dev/server/v2/contract/1/${token}`, { headers: { accept: "application/json" } });
    if (response.ok) {
      const body = (await response.json()) as { match?: string | null; runtimeMatch?: string | null };
      if (body.match || body.runtimeMatch) return { verified: true, source: "Sourcify has a source match for this address." };
    }
  } catch {
    // fall through
  }
  if (etherscanKey) {
    try {
      const url = `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=${token}&apikey=${etherscanKey}`;
      const response = await fetchImpl(url);
      const body = (await response.json()) as { result?: { SourceCode?: string; ABI?: string }[] };
      const row = body.result?.[0];
      if (row?.SourceCode && row.ABI && row.ABI !== "Contract source code not verified") {
        return { verified: true, source: "Etherscan reports verified source." };
      }
      return { verified: false, source: "Sourcify has no match and Etherscan reports the source as unverified." };
    } catch (error) {
      return { verified: false, source: `Sourcify has no match. Etherscan lookup failed (${error instanceof Error ? error.message : error}).` };
    }
  }
  return { verified: false, source: "Sourcify has no source match. Etherscan was not queried because no API key is configured." };
}

function scanSelectors(bytecode: string): { signature: string; meaning: string; present: boolean }[] {
  const body = (bytecode || "").toLowerCase().replace(/^0x/, "");
  const rows = [
    ["owner()", "Ownership read"],
    ["renounceOwnership()", "Renounce ownership"],
    ["transferOwnership(address)", "Transfer ownership"],
    ["mint(address,uint256)", "Mint to an address"],
    ["setTrading(bool)", "Trading switch"],
    ["enableTrading()", "Enable trading"],
    ["blacklist(address)", "Blacklist"],
    ["excludeFromFee(address,bool)", "Fee exclusion"],
    ["setFee(uint256,uint256)", "Fee setter"],
  ] as const;
  return rows.map(([signature, meaning]) => {
    const selector = toFunctionSelector(signature).slice(2).toLowerCase();
    return { signature, meaning, present: body.includes(selector) };
  });
}

async function quoteAtHealthyBlock(rpc: RpcPool, trades: TradeRow[], token: string, quote: string, quoteIsToken0: boolean): Promise<string> {
  const healthy = trades.find((trade) => BigInt(trade.reserveWethRaw) > 10n ** 16n);
  if (!healthy) return "No indexed block still had a meaningful quote reserve, so a historical buy/sell quote was not attempted.";
  try {
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: [{ name: "", type: "uint256[]" }] }],
      functionName: "getAmountsOut",
      args: [10n ** 15n, quoteIsToken0 ? [quote as Hex, token as Hex] : [quote as Hex, token as Hex]],
    });
    const sellData = encodeFunctionData({
      abi: [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: [{ name: "", type: "uint256[]" }] }],
      functionName: "getAmountsOut",
      args: [10n ** 15n, [token as Hex, quote as Hex]],
    });
    const router = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const buy = await rpc.call<string>("eth_call", [{ to: router, data }, hexQty(healthy.blockNumber)]);
    const sell = await rpc.call<string>("eth_call", [{ to: router, data: sellData }, hexQty(healthy.blockNumber)]);
    const buyOut = lastArrayAmount(buy);
    const sellOut = lastArrayAmount(sell);
    if (buyOut > 0n && sellOut > 0n) {
      return `At block ${healthy.blockNumber}, router getAmountsOut returned tokens in both directions for a 0.001 unit probe. That is a quote, not a guarantee about blacklist or tax logic.`;
    }
    return `At block ${healthy.blockNumber}, one side of getAmountsOut returned zero. Buy out ${buyOut.toString()}, sell out ${sellOut.toString()}.`;
  } catch (error) {
    return `Historical getAmountsOut was not available (${error instanceof Error ? error.message : error}).`;
  }
}

async function loadEthUsd(ath: number | null, start: number | null, fetchImpl: typeof fetch = fetch): Promise<AnalysisReport["ethUsd"]> {
  const stamp = ath || start;
  try {
    if (stamp) {
      const response = await fetchImpl(`https://coins.llama.fi/prices/historical/${stamp}/coingecko:ethereum`);
      if (response.ok) {
        const body = (await response.json()) as { coins?: Record<string, { price?: number; timestamp?: number }> };
        const price = body.coins?.["coingecko:ethereum"]?.price;
        if (price) return { price, source: "DefiLlama historical ETH/USD", asOf: new Date(stamp * 1000).toISOString() };
      }
    }
  } catch {
    // try current
  }
  try {
    const response = await fetchImpl("https://coins.llama.fi/prices/current/coingecko:ethereum");
    if (!response.ok) return { price: null, source: "ETH/USD unavailable", asOf: null };
    const body = (await response.json()) as { coins?: Record<string, { price?: number; timestamp?: number }> };
    const row = body.coins?.["coingecko:ethereum"];
    if (!row?.price) return { price: null, source: "ETH/USD unavailable", asOf: null };
    return { price: row.price, source: "DefiLlama current ETH/USD applied to historical WETH amounts", asOf: row.timestamp ? new Date(row.timestamp * 1000).toISOString() : null };
  } catch {
    return { price: null, source: "ETH/USD unavailable", asOf: null };
  }
}

function lastArrayAmount(data: string): bigint {
  const [amounts] = decodeAbiParameters(parseAbiParameters("uint256[]"), data as Hex);
  return amounts.length ? amounts[amounts.length - 1] : 0n;
}

function decimalToRaw(value: number, decimals: number): bigint {
  const text = value.toFixed(decimals);
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0"));
}

async function maybeAi(report: AnalysisReport, options: AnalyzeOptions): Promise<AnalysisReport> {
  if (!options.ai?.apiKey || !options.ai.baseUrl) return report;
  const packet = {
    executive: report.narrative.executive,
    limitations: report.limitations,
    findings: [...report.worked, ...report.failed].map((item) => ({ title: item.title, summary: item.summary, confidence: item.confidence })),
  };
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.ai.apiKey}` },
      body: JSON.stringify({
        model: options.ai.model || "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: "Rephrase only the supplied JSON into two short paragraphs. Do not add wallet addresses, transaction hashes, token amounts, or causes that are not written in the JSON. If you cannot comply, reply with the executive text unchanged." },
          { role: "user", content: JSON.stringify(packet) },
        ],
      }),
    });
    if (!response.ok) {
      return { ...report, narrative: { ...report.narrative, aiStatus: "failed", aiNote: `The model request returned ${response.status}. The evidence narrative is unchanged.` } };
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const prose = body.choices?.[0]?.message?.content?.trim() || "";
    const source = JSON.stringify(packet).toLowerCase();
    const introduced = prose.toLowerCase().match(/0x[a-f0-9]{40,64}/g) ?? [];
    if (introduced.some((token) => !source.includes(token))) {
      return { ...report, narrative: { ...report.narrative, aiStatus: "rejected", aiNote: "The model output contained an address or hash that was not in the structured findings, so it was discarded." } };
    }
    return { ...report, narrative: { ...report.narrative, aiStatus: "accepted", aiProse: prose, aiNote: "The model rephrased the structured findings. Numbers in the tables remain the source of truth." } };
  } catch (error) {
    return { ...report, narrative: { ...report.narrative, aiStatus: "failed", aiNote: `The model request failed (${error instanceof Error ? error.message : error}). The evidence narrative is unchanged.` } };
  }
}

void STAGE_LABELS;
void decodeSignedWords;
void normalizeAddress;
