import { getAddress, isAddress } from "viem";

export interface ParsedPairUrl {
  chainId: number;
  pair: string;
  source: "dextools" | "dexscreener" | "address";
}

const CHAIN_SLUGS: Record<string, number> = {
  ether: 1,
  eth: 1,
  ethereum: 1,
  "1": 1,
};

export function chainFromSlug(slug: string): number {
  const chainId = CHAIN_SLUGS[slug.toLowerCase()];
  if (!chainId) {
    throw new Error(
      `Chain "${slug}" is not supported. LaunchForensics reconstructs Ethereum mainnet launches. No figures were produced for this URL.`,
    );
  }
  return chainId;
}

export function parsePairUrl(input: string): ParsedPairUrl {
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    if (!isAddress(trimmed)) throw new Error("That string is not a valid Ethereum address.");
    return { chainId: 1, pair: getAddress(trimmed), source: "address" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Paste a DEXTools pair URL, a DexScreener pair URL, or a 0x pair address.");
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (host.endsWith("dextools.io")) {
    const idx = parts.findIndex((part) => part === "pair-explorer");
    const address = idx >= 0 ? parts[idx + 1] : "";
    const chainSlug = idx > 0 ? parts[idx - 1] : "";
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("This DEXTools URL does not include a pair-explorer address.");
    }
    return { chainId: chainFromSlug(chainSlug), pair: getAddress(address), source: "dextools" };
  }
  if (host.endsWith("dexscreener.com")) {
    if (parts.length < 2 || !/^0x[a-fA-F0-9]{40}$/.test(parts[1])) {
      throw new Error("This DexScreener URL does not include a chain and pair address.");
    }
    return { chainId: chainFromSlug(parts[0]), pair: getAddress(parts[1]), source: "dexscreener" };
  }
  throw new Error("Unsupported link. Use a DEXTools or DexScreener pair URL, or paste the pair address.");
}
