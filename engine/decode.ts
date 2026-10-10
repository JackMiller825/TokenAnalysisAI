import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";

export const TOPICS = {
  swapV2: keccak256(stringToHex("Swap(address,uint256,uint256,uint256,uint256,address)")),
  mintV2: keccak256(stringToHex("Mint(address,uint256,uint256)")),
  burnV2: keccak256(stringToHex("Burn(address,uint256,uint256,address)")),
  syncV2: keccak256(stringToHex("Sync(uint112,uint112)")),
  transfer: keccak256(stringToHex("Transfer(address,address,uint256)")),
  approval: keccak256(stringToHex("Approval(address,address,uint256)")),
  pairCreated: keccak256(stringToHex("PairCreated(address,address,address,uint256)")),
  ownership: keccak256(stringToHex("OwnershipTransferred(address,address)")),
  swapV3: keccak256(stringToHex("Swap(address,address,int256,int256,uint160,uint128,int24)")),
} as const;

export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const ZERO = "0x0000000000000000000000000000000000000000";
export const V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
export const V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

export const INFRA_LABELS: Record<string, string> = {
  [V2_ROUTER.toLowerCase()]: "Uniswap V2 Router",
  [V2_FACTORY.toLowerCase()]: "Uniswap V2 Factory",
  [WETH.toLowerCase()]: "WETH",
  [DEAD.toLowerCase()]: "Burn address",
  [ZERO.toLowerCase()]: "Zero address",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap Universal Router",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Uniswap Universal Router",
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b": "Uniswap Universal Router",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 SwapRouter",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch v5 Router",
  "0x111111125421ca6dc452d289314280a0f8842a65": "1inch v6 Router",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x Exchange Proxy",
};

/** Known exchange hot wallets. Shared funding from these is not a common-ownership signal. */
export const CEX_LABELS: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance",
  "0x46340b20830761efd32832a74d7169b29feb9758": "Crypto.com",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
};

const ROUTER_ABI = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
]);

export function topicToAddress(topic: string): string {
  return getAddress(`0x${topic.slice(-40)}`);
}

export function padTopic(address: string): Hex {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex;
}

export function decodeWords(data: string, count: number): bigint[] {
  const hex = (data && data !== "0x" ? data : "0x") as Hex;
  const types = Array.from({ length: count }, () => "uint256").join(", ");
  return decodeAbiParameters(parseAbiParameters(types), hex).map((value) => BigInt(value as bigint));
}

export function decodeSignedWords(data: string): { amount0: bigint; amount1: bigint; sqrtPriceX96: bigint } {
  const [amount0, amount1, sqrtPriceX96] = decodeAbiParameters(
    parseAbiParameters("int256, int256, uint160, uint128, int24"),
    data as Hex,
  );
  return { amount0, amount1, sqrtPriceX96 };
}

export function decodeRouterRecipient(input: string | undefined): { method: string; recipient: string } | null {
  if (!input || input === "0x" || input.length < 10) return null;
  try {
    const decoded = decodeFunctionData({ abi: ROUTER_ABI, data: input as Hex });
    const args = [...decoded.args] as unknown[];
    const recipient = args.find((value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value));
    if (!recipient || typeof recipient !== "string") return null;
    return { method: decoded.functionName, recipient: getAddress(recipient) };
  } catch {
    return null;
  }
}

export function decodeAbiString(data: string): string | null {
  if (!data || data === "0x") return null;
  try {
    if (data.length === 66) {
      const text = Buffer.from(data.slice(2), "hex").toString("utf8").replace(/\0/g, "").trim();
      return text || null;
    }
    const [value] = decodeAbiParameters(parseAbiParameters("string"), data as Hex);
    return value || null;
  } catch {
    return null;
  }
}

export const SELECTORS = {
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  getReserves: "0x0902f1ac",
  factory: "0xc45a0155",
  totalSupply: "0x18160ddd",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  name: "0x06fdde03",
  owner: "0x8da5cb5b",
  slot0: "0x3850c7bd",
  fee: "0xddca3f43",
  balanceOf: "0x70a08231",
} as const;

export function balanceOfData(holder: string): Hex {
  return `${SELECTORS.balanceOf}${holder.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex;
}
