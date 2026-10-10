/** Uniswap V2 constant-product output, fee included as 997/1000. */
export function v2AmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

export function v2PriceImpact(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): number | null {
  if (reserveIn <= 0n || reserveOut <= 0n || amountIn <= 0n) return null;
  const out = v2AmountOut(amountIn, reserveIn, reserveOut);
  if (out <= 0n || out >= reserveOut) return out >= reserveOut ? 1 : null;
  return relativeChange(`${reserveOut}/${reserveIn}`, `${reserveOut - out}/${reserveIn + amountIn}`);
}

/** Decimal value of a "numerator/denominator" price without underflow on tiny ratios. */
export function decimalFromRational(value: string): number {
  const [n, d] = value.split("/");
  if (!d) return Number(value);
  const numerator = BigInt(n);
  const denominator = BigInt(d);
  if (numerator === 0n || denominator === 0n) return 0;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const ns = (numerator < 0n ? -numerator : numerator).toString();
  const ds = (denominator < 0n ? -denominator : denominator).toString();
  const nd = Math.min(12, ns.length);
  const dd = Math.min(12, ds.length);
  const mantissa = Number(ns.slice(0, nd)) / Number(ds.slice(0, dd));
  const exponent = ns.length - nd - (ds.length - dd);
  const result = mantissa * 10 ** exponent;
  return negative ? -result : result;
}

export function relativeChange(before: string, after: string): number | null {
  const start = decimalFromRational(before);
  const end = decimalFromRational(after);
  if (!Number.isFinite(start) || start === 0) return null;
  return (end - start) / start;
}

export function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const scale = 1_000_000_000_000n;
  const value = Number((abs(numerator) * scale) / abs(denominator)) / 1e12;
  return negative ? -value : value;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** token price in whole quote units per whole token, as a rational string "num/den". */
export function priceRatio(reserveQuoteRaw: bigint, reserveTokenRaw: bigint, quoteDecimals: number, tokenDecimals: number): string {
  if (reserveTokenRaw === 0n) return "0/1";
  const scale = 10n ** BigInt(Math.abs(quoteDecimals - tokenDecimals));
  const numerator = quoteDecimals >= tokenDecimals ? reserveQuoteRaw : reserveQuoteRaw * scale;
  const denominator = quoteDecimals >= tokenDecimals ? reserveTokenRaw * scale : reserveTokenRaw;
  return `${numerator.toString()}/${denominator.toString()}`;
}

export function fdvRaw(reserveQuoteRaw: bigint, reserveTokenRaw: bigint, totalSupplyRaw: bigint): bigint | null {
  if (reserveTokenRaw === 0n) return null;
  return (reserveQuoteRaw * totalSupplyRaw) / reserveTokenRaw;
}

export function applyBuy(reserveWeth: bigint, reserveToken: bigint, wethIn: bigint): { reserveWeth: bigint; reserveToken: bigint; tokenOut: bigint } {
  const tokenOut = v2AmountOut(wethIn, reserveWeth, reserveToken);
  return { reserveWeth: reserveWeth + wethIn, reserveToken: reserveToken - tokenOut, tokenOut };
}

export function applySell(reserveWeth: bigint, reserveToken: bigint, tokenIn: bigint): { reserveWeth: bigint; reserveToken: bigint; wethOut: bigint } {
  const wethOut = v2AmountOut(tokenIn, reserveToken, reserveWeth);
  return { reserveWeth: reserveWeth - wethOut, reserveToken: reserveToken + tokenIn, wethOut };
}

export function sqrtPriceX96ToRatio(sqrtPriceX96: bigint, token0Decimals: number, token1Decimals: number): string {
  // price of token0 in token1 = (sqrtPriceX96^2 / 2^192) * 10^(dec0-dec1)
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(token0Decimals);
  const denominator = 2n ** 192n * 10n ** BigInt(token1Decimals);
  return `${numerator.toString()}/${denominator.toString()}`;
}
