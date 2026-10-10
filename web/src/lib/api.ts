import type { AnalysisReport, LaunchContext } from "../../../shared/types.ts";

export interface AnalysisSummary {
  id: string;
  status: string;
  stage: string;
  progress: number;
  sourceUrl: string;
  pairAddress: string;
  tokenSymbol: string | null;
  quoteSymbol: string | null;
  tokenAddress: string | null;
  deployerAddress: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface AnalysisResponse extends AnalysisSummary {
  report: AnalysisReport | null;
  context: LaunchContext;
}

export interface ProgressPayload {
  id: string;
  status: string;
  stage: string;
  stageIndex: number;
  progress: number;
  progressDetail: string;
  workCompleted: number;
  workTotal: number;
  indeterminate: boolean;
  error: string | null;
  stages: { index: number; label: string; state: "pending" | "active" | "done" }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(init?.headers || {}) }, ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || "Request failed.");
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  return response as T;
}

export const api = {
  health: () => request<{ ok: boolean; postgres: string; redis: string }>("/api/health"),
  analyses: () => request<AnalysisSummary[]>("/api/analyses"),
  analysis: (id: string) => request<AnalysisResponse>(`/api/analyses/${id}`),
  create: (url: string, context: LaunchContext) => request<AnalysisSummary>("/api/analyses", { method: "POST", body: JSON.stringify({ url, context }) }),
  progress: (id: string) => request<ProgressPayload>(`/api/analyses/${id}/progress`),
  recalculate: (id: string, context: LaunchContext, full = false) => request<{ status: string; report?: AnalysisReport }>(`/api/analyses/${id}/recalculate`, { method: "POST", body: JSON.stringify({ context, full }) }),
  cancel: (id: string) => request(`/api/analyses/${id}/cancel`, { method: "POST", body: "{}" }),
  wallets: () => request<{ address: string; role: string; label: string; notes: string }[]>("/api/wallets"),
  saveWallet: (address: string, role: string, label: string, notes: string) => request("/api/wallets", { method: "POST", body: JSON.stringify({ address, role, label, notes }) }),
  settings: () => request<{ rpcUrls: string; etherscanApiKey: string; aiBaseUrl: string; aiApiKey: string; aiModel: string; etherscanConfigured: boolean; aiConfigured: boolean }>("/api/settings"),
  saveSettings: (body: Record<string, string>) => request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  compare: (ids: string[]) => request<{ metrics: { label: string; values: (string | null)[] }[]; improved: string[]; deteriorated: string[]; caveat: string }>(`/api/comparisons?ids=${ids.join(",")}`),
  simulate: (body: { initialWeth: number; initialTokens: number; tokenDecimals: number; buys: number[]; sells: number[] }) => request<{ steps: { label: string; side: string; amountOut: number; reserveWeth: number; reserveToken: number; priceWeth: number; impact: number | null }[]; note: string }>("/api/simulate", { method: "POST", body: JSON.stringify(body) }),
};

export type { AnalysisReport, LaunchContext };
