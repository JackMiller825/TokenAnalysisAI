import { describe, expect, it } from "vitest";
import { decodeWords, TOPICS } from "../engine/decode.ts";
import { classifyActor, suspectedFromTransfers } from "../engine/economics.ts";
import { formatPriceMove, formatRaw } from "../engine/format.ts";
import { decimalFromRational, relativeChange, v2AmountOut } from "../engine/math.ts";
import { parsePairUrl } from "../engine/parseUrl.ts";
import { RpcPool } from "../engine/rpc.ts";
import { simulateAmm } from "../engine/simulate.ts";
import { emptyContext } from "../shared/types.ts";
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from "viem";

const BARSTRO = "https://www.dextools.io/app/ether/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650";

describe("pair URL parsing", () => {
  it("reads a DEXTools ether pair URL", () => {
    const parsed = parsePairUrl(BARSTRO);
    expect(parsed.chainId).toBe(1);
    expect(parsed.source).toBe("dextools");
    expect(parsed.pair.toLowerCase()).toBe("0x0d108526a484eb7927e593fd41d8a8823fc35650");
  });

  it("reads localized DEXTools and DexScreener URLs", () => {
    const localized = parsePairUrl("https://www.dextools.io/app/en/ether/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650?t=1");
    expect(localized.pair.toLowerCase()).toBe("0x0d108526a484eb7927e593fd41d8a8823fc35650");
    const screener = parsePairUrl("https://dexscreener.com/ethereum/0x0d108526a484eb7927e593fd41d8a8823fc35650");
    expect(screener.source).toBe("dexscreener");
    expect(screener.chainId).toBe(1);
  });

  it("rejects unsupported chains and pages", () => {
    expect(() => parsePairUrl("https://www.dextools.io/app/bnb/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650")).toThrow(/not supported/i);
    expect(() => parsePairUrl("https://www.dextools.io/app/ether/hot-pairs")).toThrow(/pair-explorer/i);
    expect(() => parsePairUrl("not a url")).toThrow(/Paste/);
  });
});

describe("uniswap v2 decoding", () => {
  it("uses the canonical Swap topic", () => {
    expect(TOPICS.swapV2).toBe("0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822");
    expect(TOPICS.syncV2).toBe(keccak256(stringToHex("Sync(uint112,uint112)")));
  });

  it("decodes swap words and classifies a token0 sell", () => {
    const tokenIn = 352161237876433550n;
    const wethOut = 2327341173014588000n;
    const data = encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256, uint256"), [tokenIn, 0n, 0n, wethOut]);
    const [a0in, a1in, a0out, a1out] = decodeWords(data, 4);
    expect(a0in).toBe(tokenIn);
    expect(a1in).toBe(0n);
    expect(a0out).toBe(0n);
    expect(a1out).toBe(wethOut);
    const isSell = a0in > 0n && a1out > 0n;
    expect(isSell).toBe(true);
    expect(formatRaw(wethOut, 18, 9)).toBe("2.327341173");
  });

  it("keeps a near-total price collapse from rounding to exactly zero", () => {
    const before = "2327343507361127735/352161590039000000000";
    const after = "2334346539985/352161590038023601000000000";
    const change = relativeChange(before, after);
    expect(change).not.toBeNull();
    expect(change!).toBeLessThan(-0.999);
    expect(change!).toBeGreaterThan(-1);
    expect(decimalFromRational(after)).toBeGreaterThan(0);
    const label = formatPriceMove(change);
    expect(label).toContain("of the prior price remained");
    expect(label).not.toContain("-100");
    expect(formatPriceMove(-1)).toContain("-100%");
    expect(formatPriceMove(-0.45)).toBe("-45.00%");
  });

  it("matches the constant-product quote used for price impact", () => {
    const out = v2AmountOut(1000n, 10_000n, 50_000n);
    const manual = (1000n * 997n * 50_000n) / (10_000n * 1000n + 1000n * 997n);
    expect(out).toBe(manual);
    expect(out).toBeGreaterThan(0n);
  });
});

describe("wallet classification", () => {
  const pool = "0x0d108526a484eb7927e593fd41d8a8823fc35650";
  const operator = "0x45b5f80d0160a977c2a5d2b9060997d5cfe0ca65";
  const external = "0x1111111111111111111111111111111111111111";
  const other = "0x2222222222222222222222222222222222222222";

  it("keeps unknown wallets unclassified and honors a known-external list", () => {
    const context = emptyContext();
    expect(classifyActor(other, context, false, new Map()).category).toBe("unclassified");
    context.externalWallets = [{ address: external, label: "Independent community member", notes: "" }];
    const known = classifyActor(external, context, false, new Map());
    expect(known.category).toBe("known_external");
    expect(known.label).toBe("Independent community member");
    expect(classifyActor(other, context, false, new Map()).category).toBe("unclassified");
  });

  it("does not treat shared timing, size, or a router as common ownership", () => {
    const suspected = suspectedFromTransfers(
      [
        { from: other, to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", raw: "1", txHash: "0xabc", timestamp: 1, logIndex: 1 },
        { from: operator, to: pool, raw: "5", txHash: "0xdef", timestamp: 1, logIndex: 2 },
      ],
      operator,
      pool,
    );
    expect(suspected.size).toBe(0);
  });

  it("flags a direct token transfer with the launch operator", () => {
    const suspected = suspectedFromTransfers(
      [{ from: operator, to: other, raw: "10", txHash: "0xabc123", timestamp: 1, logIndex: 1 }],
      operator,
      pool,
    );
    expect(suspected.get(other)?.[0]).toMatch(/direct/i);
    expect(classifyActor(other, emptyContext(), false, suspected).category).toBe("suspected_related");
  });

  it("labels contracts without promoting them to team wallets", () => {
    expect(classifyActor(other, emptyContext(), true, new Map()).category).toBe("known_contract");
  });
});

describe("rpc failover", () => {
  it("abandons a provider that never responds", async () => {
    const pool = new RpcPool(
      ["https://hung.example"],
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init && typeof init === "object" && "signal" in init ? (init as RequestInit).signal : null;
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
        }),
      20,
    );
    await expect(pool.call("eth_blockNumber", [])).rejects.toThrow(/did not respond/i);
  });
});

describe("simulation and formatting", () => {
  it("labels AMM scenarios and preserves a fee-reduced output", () => {
    const result = simulateAmm({ initialWeth: 0.8, initialTokens: 1_000_000_000, tokenDecimals: 9, buys: [0.1], sells: [1_000_000] });
    expect(result.note).toMatch(/simulation/i);
    expect(result.steps[1].side).toBe("buy");
    expect(result.steps[1].amountOut).toBeGreaterThan(0);
    expect(result.steps[2].reserveWeth).toBeLessThan(result.steps[1].reserveWeth);
  });

  it("keeps raw integer formatting exact", () => {
    expect(formatRaw("2341371", 18, 18)).toBe("0.000000000002341371");
    expect(formatRaw("800000000000000000", 18, 4)).toBe("0.8");
  });
});
