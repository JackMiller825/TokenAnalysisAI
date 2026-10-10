export function formatRaw(raw: string | bigint | null | undefined, decimals: number, maxFrac = 6): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let fracStr = frac.toString().padStart(decimals, "0");
  if (maxFrac < decimals) {
    const extra = fracStr.slice(maxFrac, maxFrac + 1);
    fracStr = fracStr.slice(0, maxFrac);
    if (extra && extra >= "5" && fracStr.length > 0) {
      const bumped = (BigInt(fracStr || "0") + 1n).toString().padStart(maxFrac, "0");
      if (bumped.length > maxFrac) {
        return `${negative ? "-" : ""}${(whole + 1n).toString()}`;
      }
      fracStr = bumped;
    }
  }
  fracStr = fracStr.replace(/0+$/, "");
  const body = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function formatNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Price-move text that does not round a non-zero remainder to a total loss. */
export function formatPriceMove(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === -1) return "-100% (the post-move price is zero)";
  if (value > -1 && value < 0) {
    const remained = 1 + value;
    if (remained > 0 && remained < 1e-4) return `${remained.toExponential(3)} of the prior price remained`;
  }
  if (value > 0 && value < 1) {
    const remained = 1 - value;
    if (remained > 0 && remained < 1e-4) return `${remained.toExponential(3)} of the reference price remained`;
  }
  return formatPct(value, digits);
}

export function shortAddr(address: string): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function priceNumber(rawRatio: string | null): number {
  if (!rawRatio) return 0;
  const [n, d] = rawRatio.split("/");
  if (!d) return Number(rawRatio);
  const num = BigInt(n);
  const den = BigInt(d);
  if (den === 0n) return 0;
  const scale = 1_000_000_000_000n;
  return Number((num * scale) / den) / 1e12;
}

export function rawToNumber(raw: string, decimals: number): number {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const scale = 1_000_000n;
  return Number((value * scale) / base) / 1e6;
}

export function medianBig(values: bigint[]): bigint | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2n;
}

export function sumBig(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}
