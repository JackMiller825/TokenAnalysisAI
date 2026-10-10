import type { AnalysisReport, LaunchContext } from "../../../shared/types.ts";
import { STAGE_LABELS } from "../../../shared/types.ts";
import type { AnalysisResponse, AnalysisSummary, ProgressPayload } from "./api";

const WALLET_KEY = "launchforensics.savedWallets";

interface SavedWallet {
  address: string;
  role: string;
  label: string;
  notes: string;
}

let reports: AnalysisResponse[] | null = null;

export const publishedSiteMessage =
  "This published site shows the saved BARSTRO investigation. GitHub Pages cannot query Ethereum or store API keys. Run the local server to start a new chain analysis.";

function siteRoot(): string {
  let path = window.location.pathname;
  if (path.endsWith("/index.html")) path = path.slice(0, -"/index.html".length);
  if (!path.endsWith("/")) path += "/";
  return path;
}

async function loadReports(): Promise<AnalysisResponse[]> {
  if (reports) return reports;
  const response = await fetch(`${siteRoot()}demo/barstro.json`);
  if (!response.ok) throw new Error("The published BARSTRO snapshot could not be loaded.");
  const row = (await response.json()) as AnalysisResponse;
  reports = [row];
  return reports;
}

function summary(row: AnalysisResponse): AnalysisSummary {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    sourceUrl: row.sourceUrl,
    pairAddress: row.pairAddress,
    tokenSymbol: row.tokenSymbol,
    quoteSymbol: row.quoteSymbol,
    tokenAddress: row.tokenAddress,
    deployerAddress: row.deployerAddress,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    error: row.error,
  };
}

function readWallets(): SavedWallet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WALLET_KEY) || "[]") as SavedWallet[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function progressOf(row: AnalysisResponse): ProgressPayload {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    stageIndex: STAGE_LABELS.length - 1,
    progress: 100,
    progressDetail: "Published snapshot",
    workCompleted: STAGE_LABELS.length,
    workTotal: STAGE_LABELS.length,
    indeterminate: false,
    error: row.error,
    stages: STAGE_LABELS.map((label, index) => ({ index, label, state: "done" as const })),
  };
}

function csvOf(report: AnalysisReport): string {
  const header = "timestamp,side,actor,category,token_raw,quote_raw,impact,tx_hash,block\n";
  const body = report.trades
    .map((trade) => [new Date(trade.timestamp * 1000).toISOString(), trade.side, trade.actor, trade.category, trade.tokenRaw, trade.wethRaw, trade.immediateImpact ?? "", trade.txHash, trade.blockNumber].join(","))
    .join("\n");
  return header + body;
}

export async function downloadSnapshot(id: string, format: "json" | "csv") {
  const row = (await loadReports()).find((item) => item.id === id);
  if (!row?.report) throw new Error("That report is not in the published snapshot.");
  const contents = format === "json" ? JSON.stringify(row.report, null, 2) : csvOf(row.report);
  const blob = new Blob([contents], { type: format === "json" ? "application/json" : "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${row.report.token.symbol || "launch"}-${format === "json" ? "report.json" : "trades.csv"}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function staticRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, "http://static.local");
  const method = (init?.method || "GET").toUpperCase();
  const id = url.pathname.split("/")[3];

  if (url.pathname === "/api/health" && method === "GET") {
    return { ok: false, postgres: "published snapshot", redis: "not used on GitHub Pages" } as T;
  }
  if (url.pathname === "/api/analyses" && method === "GET") {
    return (await loadReports()).map(summary) as T;
  }
  if (url.pathname === "/api/analyses" && method === "POST") {
    throw new Error(publishedSiteMessage);
  }
  if (url.pathname === `/api/analyses/${id}` && method === "GET") {
    const row = (await loadReports()).find((item) => item.id === id);
    if (!row) throw new Error("Analysis not found.");
    return row as T;
  }
  if (url.pathname === `/api/analyses/${id}/progress` && method === "GET") {
    const row = (await loadReports()).find((item) => item.id === id);
    if (!row) throw new Error("Analysis not found.");
    return progressOf(row) as T;
  }
  if (url.pathname === `/api/analyses/${id}/recalculate` && method === "POST") {
    const body = JSON.parse(init?.body as string) as { context?: LaunchContext; full?: boolean };
    if (body.full) throw new Error(publishedSiteMessage);
    const row = (await loadReports()).find((item) => item.id === id);
    if (!row?.report) throw new Error("Analysis not found.");
    const { reclassifyReport } = await import("../../../engine/analyze.ts");
    const context = { ...row.context, ...body.context };
    row.context = context;
    row.report = reclassifyReport(row.report, context);
    return { status: "completed", report: row.report } as T;
  }
  if (url.pathname === `/api/analyses/${id}/cancel` && method === "POST") {
    return { ok: true } as T;
  }
  if (url.pathname === "/api/wallets" && method === "GET") {
    return readWallets() as T;
  }
  if (url.pathname === "/api/wallets" && method === "POST") {
    const body = JSON.parse(init?.body as string) as SavedWallet;
    const next = readWallets().filter((wallet) => !(wallet.address === body.address.toLowerCase() && wallet.role === body.role));
    next.unshift({ ...body, address: body.address.toLowerCase() });
    localStorage.setItem(WALLET_KEY, JSON.stringify(next));
    return body as T;
  }
  if (url.pathname === "/api/settings" && method === "GET") {
    return { rpcUrls: "", etherscanApiKey: "", aiBaseUrl: "", aiApiKey: "", aiModel: "", etherscanConfigured: false, aiConfigured: false } as T;
  }
  if (url.pathname === "/api/settings" && method === "PUT") {
    throw new Error("API keys stay on the local server. The published site does not store them.");
  }
  if (url.pathname === "/api/comparisons" && method === "GET") {
    const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
    const rows = await loadReports();
    const selected = ids.map((item) => rows.find((row) => row.id === item)).filter((row) => row?.report);
    if (selected.length < 2) throw new Error("At least two selected analyses need a completed report.");
    const { compareAnalyses } = await import("../../../engine/compare.ts");
    return compareAnalyses(selected.map((row) => ({ id: row!.id, label: `${row!.tokenSymbol ?? "Token"} · ${row!.pairAddress.slice(0, 8)}`, report: row!.report! }))) as T;
  }
  if (url.pathname === "/api/simulate" && method === "POST") {
    const body = JSON.parse(init?.body as string) as { initialWeth: number; initialTokens: number; tokenDecimals: number; buys: number[]; sells: number[] };
    const { simulateAmm } = await import("../../../engine/simulate.ts");
    return simulateAmm(body) as T;
  }
  throw new Error(publishedSiteMessage);
}
