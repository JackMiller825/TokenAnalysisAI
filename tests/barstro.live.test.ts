import { describe, expect, it } from "vitest";
import { runAnalysis } from "../engine/analyze.ts";
import { formatRaw } from "../engine/format.ts";
import { reclassifyReport } from "../engine/analyze.ts";
import { emptyContext } from "../shared/types.ts";

const URL = "https://www.dextools.io/app/ether/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650";
const SELL = "0x2d1ee2d1fd80d2ff15a6289e6b04a4e4660f49f0c754c16534173789f0695325";
const DUST = "0xb3c77dc9d2ea42f7503be3c0d6a866f39d5457f56fbb68608391ffc9b2959391";

describe("BARSTRO live reconstruction", () => {
  it("reconstructs the launch from Ethereum logs", async () => {
    const report = await runAnalysis({ url: URL, context: emptyContext() });
    expect(report.token.address.toLowerCase()).toBe("0x8c58abe623dcd8daeea8400a34384ef003c44ff9");
    expect(report.pair.address.toLowerCase()).toBe("0x0d108526a484eb7927e593fd41d8a8823fc35650");
    expect(report.quote.symbol.toUpperCase()).toBe("WETH");
    expect(report.token.symbol.toUpperCase()).toBe("BARSTRO");
    expect(report.launchOperator.address).toBe("0x45b5f80d0160a977c2a5d2b9060997d5cfe0ca65");
    expect(report.launch.initialWethRaw).toBe("800000000000000000");
    expect(BigInt(report.liquidity.burnedRaw || "0")).toBeGreaterThan(0n);
    expect(report.liquidity.removedViaBurn).toBe(false);
    expect(report.liquidity.explanation.toLowerCase()).toMatch(/sell/);
    expect(report.external.status).toBe("not_provided");
    expect(report.narrative.organic).toMatch(/not been established/i);

    const drain = report.trades.find((trade) => trade.txHash.toLowerCase() === SELL);
    expect(drain).toBeTruthy();
    expect(drain?.side).toBe("sell");
    expect(drain?.actor).toBe("0x45b5f80d0160a977c2a5d2b9060997d5cfe0ca65");
    expect(formatRaw(drain!.wethRaw, 18, 9)).toBe("2.327341173");
    expect(drain?.immediateImpact).not.toBeNull();
    expect(drain!.immediateImpact!).toBeGreaterThan(-1);
    expect(drain!.immediateImpact!).toBeLessThan(-0.999);
    const impactFinding = report.failed.find((finding) => finding.id === "single-sell-impact");
    expect(impactFinding?.summary).toMatch(/1\.003e-12/);
    expect(impactFinding?.summary).not.toMatch(/-100\.0%/);

    const dust = report.trades.find((trade) => trade.txHash.toLowerCase() === DUST);
    expect(dust).toBeTruthy();
    expect(dust?.actor).toBe("0x45b5f80d0160a977c2a5d2b9060997d5cfe0ca65");
    expect(BigInt(dust!.wethRaw)).toBeGreaterThan(0n);
    expect(BigInt(dust!.wethRaw)).toBeLessThan(10n ** 16n);
    expect(BigInt(dust!.reserveWethRaw)).toBeLessThan(10n ** 10n);
    expect(report.flows.balanced).toBe(true);
    expect(report.security.safetyRating).toBe("not_assessed");

    const buyers = report.wallets.filter((wallet) => wallet.buyCount > 0 && wallet.category === "unclassified");
    expect(buyers.length).toBeGreaterThan(0);
    const sample = buyers.slice(0, 2).map((wallet) => wallet.address);
    const relabeled = reclassifyReport(report, {
      ...emptyContext(),
      externalWallets: sample.map((address, index) => ({ address, label: index === 0 ? "Confirmed outside trader" : "Independent community member", notes: "" })),
    });
    expect(relabeled.external.status).toBe("computed");
    expect(relabeled.external.knownExternalBuyers).toBeGreaterThan(0);
    for (const address of sample) {
      expect(relabeled.wallets.find((wallet) => wallet.address === address)?.category).toBe("known_external");
    }
    const still = relabeled.wallets.find((wallet) => wallet.buyCount > 0 && !sample.includes(wallet.address) && wallet.address !== report.launchOperator.address);
    expect(still?.category).not.toBe("confirmed_team");
    expect(relabeled.external.assumption).toBeNull();
    const assumed = reclassifyReport(report, { ...emptyContext(), externalWallets: sample.map((address) => ({ address })), assumptionTreatUnlistedAsTeam: true });
    expect(assumed.external.assumption?.enabled).toBe(true);
    expect(assumed.wallets.filter((wallet) => wallet.category === "unclassified").length).toBeGreaterThan(0);
  }, 180_000);
});
