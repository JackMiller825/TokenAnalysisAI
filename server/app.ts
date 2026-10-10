import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { compareAnalyses } from "../engine/compare.ts";
import { parsePairUrl } from "../engine/parseUrl.ts";
import { simulateAmm } from "../engine/simulate.ts";
import { ANALYSIS_VERSION, STAGE_LABELS, emptyContext, type AnalysisReport, type LaunchContext } from "../shared/types.ts";
import { createAnalysisSchema, launchContextSchema, savedWalletSchema, settingsSchema, simulateSchema } from "../shared/schemas.ts";
import { audit, prisma } from "./db.ts";
import { renderPdf } from "./pdf.ts";
import { analysisQueue, enqueueAnalysis, recalculateStored } from "./worker.ts";

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
  app.register(cors, { origin: process.env.WEB_ORIGIN || true });
  app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: error.issues.map((issue) => issue.message).join(" ") });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Request failed.";
    return reply.code(status).send({ error: message });
  });

  app.get("/api/health", async () => {
    let postgres = "ok";
    let redis = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      postgres = error instanceof Error ? error.message : "down";
    }
    try {
      await analysisQueue.waitUntilReady();
    } catch (error) {
      redis = error instanceof Error ? error.message : "down";
    }
    return { ok: postgres === "ok" && redis === "ok", postgres, redis, version: ANALYSIS_VERSION, service: "launchforensics" };
  });

  app.get("/api/settings", async () => maskSettings(await loadSettings()));

  app.put("/api/settings", async (request) => {
    const body = settingsSchema.parse(request.body);
    const current = await loadSettings();
    const saved = await prisma.appSetting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        rpcUrls: body.rpcUrls ?? "",
        etherscanApiKey: keepSecret(body.etherscanApiKey, current.etherscanApiKey),
        aiBaseUrl: body.aiBaseUrl ?? "",
        aiApiKey: keepSecret(body.aiApiKey, current.aiApiKey),
        aiModel: body.aiModel ?? "",
      },
      update: {
        rpcUrls: body.rpcUrls ?? "",
        etherscanApiKey: keepSecret(body.etherscanApiKey, current.etherscanApiKey),
        aiBaseUrl: body.aiBaseUrl ?? "",
        aiApiKey: keepSecret(body.aiApiKey, current.aiApiKey),
        aiModel: body.aiModel ?? "",
      },
    });
    await audit("settings.updated", "Provider settings updated");
    return maskSettings(saved);
  });

  app.get("/api/wallets", async () => prisma.savedWallet.findMany({ orderBy: { updatedAt: "desc" } }));

  app.post("/api/wallets", async (request) => {
    const body = savedWalletSchema.parse(request.body);
    const address = body.address.toLowerCase();
    return prisma.savedWallet.upsert({
      where: { address_role: { address, role: body.role } },
      create: { address, role: body.role, label: body.label ?? "", notes: body.notes ?? "" },
      update: { label: body.label ?? "", notes: body.notes ?? "" },
    });
  });

  app.delete("/api/wallets/:address/:role", async (request, reply) => {
    const { address, role } = request.params as { address: string; role: string };
    await prisma.savedWallet.deleteMany({ where: { address: address.toLowerCase(), role } });
    return reply.code(204).send();
  });

  app.get("/api/analyses", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const rows = await prisma.analysis.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(summaryOf);
  });

  app.post("/api/analyses", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = createAnalysisSchema.parse(request.body);
    let parsed: ReturnType<typeof parsePairUrl>;
    try {
      parsed = parsePairUrl(body.url);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid pair URL." });
    }
    const context = launchContextSchema.parse({ ...emptyContext(), ...body.context });
    const idempotencyKey = body.idempotencyKey || createHash("sha256").update(JSON.stringify({ url: body.url.trim(), context })).digest("hex");
    const existing = await prisma.analysis.findFirst({ where: { idempotencyKey, status: { in: ["queued", "running"] } } });
    if (existing) return existing;
    const created = await prisma.analysis.create({
      data: {
        status: "queued",
        stage: STAGE_LABELS[0],
        sourceUrl: body.url.trim(),
        pairAddress: parsed.pair.toLowerCase(),
        chainId: parsed.chainId,
        idempotencyKey,
        context,
      },
    });
    await enqueueAnalysis(created.id);
    await audit("analysis.queued", body.url.trim(), created.id);
    return reply.code(202).send(summaryOf(created));
  });

  app.get("/api/analyses/:id", async (request, reply) => {
    const row = await findOr404(request, reply);
    if (!row) return;
    return { ...summaryOf(row), report: row.report, context: row.context };
  });

  app.get("/api/analyses/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await prisma.analysis.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "Analysis not found." });
    if (!String(request.headers.accept || "").includes("text/event-stream")) return toProgress(current);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = async () => {
      const row = await prisma.analysis.findUnique({ where: { id } });
      if (!row) return false;
      reply.raw.write(`data: ${JSON.stringify(toProgress(row))}\n\n`);
      return !["completed", "failed", "cancelled"].includes(row.status);
    };
    let open = true;
    request.raw.on("close", () => {
      open = false;
    });
    if (!(await send())) {
      reply.raw.end();
      return;
    }
    const timer = setInterval(async () => {
      if (!open) {
        clearInterval(timer);
        return;
      }
      const more = await send().catch(() => false);
      if (!more) {
        clearInterval(timer);
        reply.raw.end();
      }
    }, 700);
  });

  app.get("/api/analyses/:id/summary", async (request, reply) => {
    const row = await findOr404(request, reply);
    if (!row) return;
    const report = row.report as AnalysisReport | null;
    if (!report) return { status: row.status, report: null };
    const { trades, tokenTransfers, ...rest } = report;
    return { status: row.status, tradeCount: trades.length, transferCount: tokenTransfers.length, report: rest };
  });

  app.get("/api/analyses/:id/events", async (request, reply) => page(request, reply, "events"));
  app.get("/api/analyses/:id/trades", async (request, reply) => page(request, reply, "trades"));
  app.get("/api/analyses/:id/buyers", async (request, reply) => sliceWallets(request, reply, "buy"));
  app.get("/api/analyses/:id/sellers", async (request, reply) => sliceWallets(request, reply, "sell"));
  app.get("/api/analyses/:id/wallets", async (request, reply) => {
    const report = await reportOr404(request, reply);
    if (!report) return;
    return { wallets: report.wallets, edges: report.edges, external: report.external };
  });
  app.get("/api/analyses/:id/flows", async (request, reply) => {
    const report = await reportOr404(request, reply);
    return report ? report.flows : undefined;
  });
  app.get("/api/analyses/:id/liquidity", async (request, reply) => {
    const report = await reportOr404(request, reply);
    return report ? { liquidity: report.liquidity, events: report.liquidityEvents } : undefined;
  });
  app.get("/api/analyses/:id/security", async (request, reply) => {
    const report = await reportOr404(request, reply);
    return report ? report.security : undefined;
  });
  app.get("/api/analyses/:id/diagnosis", async (request, reply) => {
    const report = await reportOr404(request, reply);
    if (!report) return;
    return { scores: report.scores, overall: report.overall, worked: report.worked, failed: report.failed, narrative: report.narrative, limitations: report.limitations };
  });
  app.get("/api/analyses/:id/recommendations", async (request, reply) => {
    const report = await reportOr404(request, reply);
    return report ? report.recommendations : undefined;
  });

  app.post("/api/analyses/:id/cancel", async (request, reply) => {
    const row = await findOr404(request, reply);
    if (!row) return;
    await prisma.analysis.update({ where: { id: row.id }, data: { cancelRequested: true } });
    await audit("analysis.cancel_requested", "Cancellation requested", row.id);
    return { ok: true };
  });

  app.post("/api/analyses/:id/recalculate", async (request, reply) => {
    const row = await findOr404(request, reply);
    if (!row) return;
    const body = (request.body ?? {}) as { context?: LaunchContext; full?: boolean };
    const context = launchContextSchema.parse({ ...emptyContext(), ...(row.context as object), ...body.context });
    if (body.full) {
      await prisma.analysis.update({ where: { id: row.id }, data: { status: "queued", cancelRequested: false, context: context as object, error: null, progress: 1, stage: STAGE_LABELS[0] } });
      await analysisQueue.add("analyze", { analysisId: row.id }, { jobId: `${row.id}-full-${Date.now()}`, attempts: 2, backoff: { type: "exponential", delay: 4000 } });
      return { status: "queued" };
    }
    const report = await recalculateStored(row.id, context);
    return { status: "completed", report };
  });

  app.get("/api/analyses/:id/export", async (request, reply) => {
    const row = await findOr404(request, reply);
    if (!row?.report) return reply.code(409).send({ error: "The report is not ready to export." });
    const report = row.report as unknown as AnalysisReport;
    const format = ((request.query as { format?: string }).format || "json").toLowerCase();
    await audit("analysis.exported", format, row.id);
    if (format === "csv") {
      const header = "timestamp,side,actor,category,token_raw,quote_raw,impact,tx_hash,block\n";
      const body = report.trades
        .map((trade) => [new Date(trade.timestamp * 1000).toISOString(), trade.side, trade.actor, trade.category, trade.tokenRaw, trade.wethRaw, trade.immediateImpact ?? "", trade.txHash, trade.blockNumber].join(","))
        .join("\n");
      return reply.header("content-type", "text/csv").header("content-disposition", `attachment; filename="${report.token.symbol}-trades.csv"`).send(header + body);
    }
    if (format === "pdf") {
      const pdf = await renderPdf(report);
      return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${report.token.symbol}-launch-report.pdf"`).send(pdf);
    }
    return reply.header("content-disposition", `attachment; filename="${report.token.symbol}-report.json"`).send(report);
  });

  app.get("/api/comparisons", async (request, reply) => {
    const ids = String((request.query as { ids?: string }).ids || "").split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length < 2) return reply.code(400).send({ error: "Select at least two completed analyses." });
    const rows = await prisma.analysis.findMany({ where: { id: { in: ids } } });
    const ordered = ids.map((id) => rows.find((row) => row.id === id)).filter((row) => row?.report);
    if (ordered.length < 2) return reply.code(400).send({ error: "At least two selected analyses need a completed report." });
    return compareAnalyses(ordered.map((row) => ({ id: row!.id, label: `${row!.tokenSymbol ?? "Token"} · ${row!.pairAddress.slice(0, 8)}`, report: row!.report as unknown as AnalysisReport })));
  });

  app.post("/api/simulate", async (request) => {
    const body = simulateSchema.parse(request.body);
    return simulateAmm(body);
  });

  return app;
}

function summaryOf(row: {
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
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
}) {
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

function toProgress(row: { id: string; status: string; stage: string; stageIndex: number; progress: number; progressDetail: string; workCompleted: number; workTotal: number; indeterminate: boolean; error: string | null }) {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    stageIndex: row.stageIndex,
    progress: row.progress,
    progressDetail: row.progressDetail,
    workCompleted: row.workCompleted,
    workTotal: row.workTotal,
    indeterminate: row.indeterminate,
    error: row.error,
    stages: STAGE_LABELS.map((label, index) => ({
      index,
      label,
      state: row.status === "completed" || index < row.stageIndex ? "done" : index === row.stageIndex && row.status === "running" ? "active" : "pending",
    })),
  };
}

async function findOr404(request: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  const { id } = request.params as { id: string };
  const row = await prisma.analysis.findUnique({ where: { id } });
  if (!row) {
    reply.code(404).send({ error: "Analysis not found." });
    return null;
  }
  return row;
}

async function reportOr404(request: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  const row = await findOr404(request, reply);
  if (!row) return null;
  if (!row.report) {
    reply.code(409).send({ error: "The analysis is still running." });
    return null;
  }
  return row.report as unknown as AnalysisReport;
}

async function page(request: { params: unknown; query: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, kind: "trades" | "events") {
  const report = await reportOr404(request, reply);
  if (!report) return;
  const query = request.query as { limit?: string; offset?: string; side?: string; category?: string; wallet?: string };
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  if (kind === "events") {
    const rows = report.liquidityEvents;
    return { total: rows.length, rows: rows.slice(offset, offset + limit) };
  }
  let rows = report.trades;
  if (query.side) rows = rows.filter((trade) => trade.side === query.side);
  if (query.category) rows = rows.filter((trade) => trade.category === query.category);
  if (query.wallet) {
    const wallet = query.wallet.toLowerCase();
    rows = rows.filter((trade) => trade.actor === wallet);
  }
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

async function sliceWallets(request: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, side: "buy" | "sell") {
  const report = await reportOr404(request, reply);
  if (!report) return;
  return {
    external: report.external,
    wallets: report.wallets.filter((wallet) => (side === "buy" ? wallet.buyCount : wallet.sellCount) > 0),
    sellers: side === "sell" ? report.sellers : undefined,
    summary: report.summary,
  };
}

async function loadSettings() {
  return (await prisma.appSetting.findUnique({ where: { id: "default" } })) ?? {
    id: "default",
    rpcUrls: "",
    etherscanApiKey: "",
    aiBaseUrl: "",
    aiApiKey: "",
    aiModel: "",
    updatedAt: new Date(),
  };
}

function maskSettings(row: { rpcUrls: string; etherscanApiKey: string; aiBaseUrl: string; aiApiKey: string; aiModel: string }) {
  return {
    rpcUrls: row.rpcUrls,
    etherscanApiKey: mask(row.etherscanApiKey),
    aiBaseUrl: row.aiBaseUrl,
    aiApiKey: mask(row.aiApiKey),
    aiModel: row.aiModel,
    etherscanConfigured: Boolean(row.etherscanApiKey),
    aiConfigured: Boolean(row.aiApiKey && row.aiBaseUrl),
  };
}

function mask(secret: string) {
  if (!secret) return "";
  return `••••${secret.slice(-4)}`;
}

function keepSecret(incoming: string | undefined, current: string) {
  if (incoming === undefined) return current;
  if (!incoming || incoming.startsWith("••••")) return current;
  return incoming;
}
