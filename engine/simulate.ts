import type { SimulationStep } from "../shared/types.ts";
import { applyBuy, applySell, decimalFromRational, relativeChange } from "./math.ts";

export function simulateAmm(input: {
  initialWeth: number;
  initialTokens: number;
  tokenDecimals: number;
  buys: number[];
  sells: number[];
}): { steps: SimulationStep[]; note: string } {
  const dec = input.tokenDecimals;
  let reserveWeth = decimal(input.initialWeth, 18);
  let reserveToken = decimal(input.initialTokens, dec);
  const steps: SimulationStep[] = [
    {
      label: "Opening reserves",
      side: "seed",
      amountIn: input.initialWeth,
      amountOut: input.initialTokens,
      reserveWeth: input.initialWeth,
      reserveToken: input.initialTokens,
      priceWeth: input.initialTokens > 0 ? input.initialWeth / input.initialTokens : 0,
      impact: null,
    },
  ];
  const actions: { side: "buy" | "sell"; amount: number }[] = [
    ...input.buys.map((amount) => ({ side: "buy" as const, amount })),
    ...input.sells.map((amount) => ({ side: "sell" as const, amount })),
  ];
  for (const action of actions) {
    const beforeRatio = `${reserveWeth}/${reserveToken}`;
    if (action.side === "buy") {
      const amount = decimal(action.amount, 18);
      const next = applyBuy(reserveWeth, reserveToken, amount);
      reserveWeth = next.reserveWeth;
      reserveToken = next.reserveToken;
      const price = spotPrice(reserveWeth, reserveToken, dec);
      steps.push({
        label: `Hypothetical buy of ${action.amount} WETH`,
        side: "buy",
        amountIn: action.amount,
        amountOut: Number(next.tokenOut) / 10 ** dec,
        reserveWeth: Number(reserveWeth) / 1e18,
        reserveToken: Number(reserveToken) / 10 ** dec,
        priceWeth: price,
        impact: relativeChange(beforeRatio, `${reserveWeth}/${reserveToken}`),
      });
    } else {
      const amount = decimal(action.amount, dec);
      const next = applySell(reserveWeth, reserveToken, amount);
      reserveWeth = next.reserveWeth;
      reserveToken = next.reserveToken;
      const price = spotPrice(reserveWeth, reserveToken, dec);
      steps.push({
        label: `Hypothetical sell of ${action.amount} tokens`,
        side: "sell",
        amountIn: action.amount,
        amountOut: Number(next.wethOut) / 1e18,
        reserveWeth: Number(reserveWeth) / 1e18,
        reserveToken: Number(reserveToken) / 10 ** dec,
        priceWeth: price,
        impact: relativeChange(beforeRatio, `${reserveWeth}/${reserveToken}`),
      });
    }
  }
  return {
    steps,
    note: "This path is a labeled Uniswap V2 simulation with a 0.30% fee. It is not a reconstruction of an executed launch and it does not predict participants.",
  };
}

function spotPrice(reserveWeth: bigint, reserveToken: bigint, tokenDecimals: number): number {
  if (reserveToken <= 0n) return 0;
  return decimalFromRational(`${reserveWeth}/${reserveToken}`) * 10 ** (tokenDecimals - 18);
}

function decimal(value: number, decimals: number): bigint {
  const [whole, frac = ""] = value.toFixed(Math.min(decimals, 8)).split(".");
  const padded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}
