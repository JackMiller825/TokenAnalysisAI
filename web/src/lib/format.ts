export function formatRaw(raw: string | null | undefined, decimals: number, maxFrac = 6): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const body = frac ? `${whole.toString()}.${frac}` : whole.toString();
  const withCommas = body.replace(/^(\d+)/, (m) => Number(m).toLocaleString("en-US"));
  return negative ? `-${withCommas}` : withCommas;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value >= 100 ? 0 : 2 });
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

export function shortAddr(address?: string | null): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTime(unix: number | null | undefined, timeZone: string): string {
  if (!unix) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(unix * 1000));
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "known_external": return "Known external";
    case "confirmed_team": return "Confirmed team";
    case "suspected_related": return "Suspected related";
    case "known_contract": return "Known contract";
    default: return "Unclassified";
  }
}

export const CATEGORY_COLOR: Record<string, string> = {
  known_external: "#22d3ee",
  confirmed_team: "#fbbf24",
  suspected_related: "#fb923c",
  known_contract: "#a78bfa",
  unclassified: "#94a3b8",
};
