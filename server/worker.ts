import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { CancelledError, reclassifyReport, runAnalysis } from "../engine/index.ts";
import type { AnalysisReport, LaunchContext } from "../shared/types.ts";
import { STAGE_LABELS } from "../shared/types.ts";
import { audit, prisma } from "./db.ts";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const queueConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
export const workerConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
export const analysisQueue = new Queue("launch-forensics", { connection: queueConnection });

let lastWrite = 0;

export async function enqueueAnalysis(analysisId: string) {
  await analysisQueue.add("analyze", { analysisId }, { jobId: analysisId, attempts: 2, backoff: { type: "exponential", delay: 4000 }, removeOnComplete: 100, removeOnFail: 100 });
}

export function startWorker() {
  const worker = new Worker(
    "launch-forensics",
    async (job) => {
      const analysisId = String(job.data.analysisId);
      const row = await prisma.analysis.findUnique({ where: { id: analysisId } });
      if (!row || row.status === "cancelled") return;
      const settings = await prisma.appSetting.findUnique({ where: { id: "default" } });
      const rpcUrls = (settings?.rpcUrls || process.env.RPC_URLS || "").split(",").map((item) => item.trim()).filter(Boolean);
      const context = row.context as unknown as LaunchContext;
      await prisma.analysis.update({ where: { id: analysisId }, data: { status: "running", stage: STAGE_LABELS[0], progress: 1 } });
      try {
        const report = await runAnalysis({
          url: row.sourceUrl,
          context,
          rpcUrls,
          etherscanApiKey: settings?.etherscanApiKey || process.env.ETHERSCAN_API_KEY || undefined,
          ai: settings?.aiApiKey && settings.aiBaseUrl ? { apiKey: settings.aiApiKey, baseUrl: settings.aiBaseUrl, model: settings.aiModel || "gpt-4o-mini" } : process.env.AI_API_KEY && process.env.AI_BASE_URL ? { apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL || "gpt-4o-mini" } : null,
          isCancelled: asyncCancelled(analysisId),
          onProgress: (update) => {
            const fraction = update.total > 0 ? update.completed / update.total : 0;
            const progress = Math.max(1, Math.min(99, ((update.stageIndex + fraction) / STAGE_LABELS.length) * 100));
            const now = Date.now();
            if (now - lastWrite < 400 && update.stageIndex < STAGE_LABELS.length - 1) return;
            lastWrite = now;
            void prisma.analysis.update({
              where: { id: analysisId },
              data: {
                stageIndex: update.stageIndex,
                stage: STAGE_LABELS[update.stageIndex] ?? update.detail,
                progress,
                progressDetail: update.detail,
                workCompleted: update.completed,
                workTotal: update.total,
                indeterminate: Boolean(update.indeterminate || update.total <= 0),
              },
            }).catch(() => undefined);
          },
        });
        await persistReport(analysisId, report);
        await audit("analysis.completed", `${report.token.symbol} report stored`, analysisId);
      } catch (error) {
        if (error instanceof CancelledError) {
          await prisma.analysis.update({ where: { id: analysisId }, data: { status: "cancelled", error: error.message, progressDetail: "Cancelled" } });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        await prisma.analysis.update({ where: { id: analysisId }, data: { status: "failed", error: message, stage: "Failed", progressDetail: message } });
        await audit("analysis.failed", message, analysisId);
        throw error;
      }
    },
    { connection: workerConnection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => {
    console.error("analysis job failed", job?.id, error.message);
  });
  return worker;
}

function asyncCancelled(id: string) {
  let last = 0;
  let cancelled = false;
  return () => {
    const now = Date.now();
    if (now - last > 1000) {
      last = now;
      void prisma.analysis.findUnique({ where: { id }, select: { cancelRequested: true } }).then((row) => {
        cancelled = Boolean(row?.cancelRequested);
      });
    }
    return cancelled;
  };
}

export async function persistReport(analysisId: string, report: AnalysisReport) {
  await prisma.trade.deleteMany({ where: { analysisId } });
  const trades = report.trades.map((trade) => ({
    analysisId,
    txHash: trade.txHash,
    logIndex: trade.logIndex,
    blockNumber: trade.blockNumber,
    timestamp: new Date(trade.timestamp * 1000),
    side: trade.side,
    actor: trade.actor,
    recipient: trade.recipient,
    category: trade.category,
    tokenRaw: trade.tokenRaw,
    wethRaw: trade.wethRaw,
    priceAfter: trade.priceAfter,
    immediateImpact: trade.immediateImpact,
    reserveTokenRaw: trade.reserveTokenRaw,
    reserveWethRaw: trade.reserveWethRaw,
    method: trade.method,
  }));
  for (let index = 0; index < trades.length; index += 200) {
    await prisma.trade.createMany({ data: trades.slice(index, index + 200) });
  }
  await prisma.analysis.update({
    where: { id: analysisId },
    data: {
      status: "completed",
      progress: 100,
      stage: "Complete",
      stageIndex: STAGE_LABELS.length - 1,
      progressDetail: "Report ready",
      indeterminate: false,
      completedAt: new Date(),
      error: null,
      tokenAddress: report.token.address,
      quoteAddress: report.quote.address,
      tokenSymbol: report.token.symbol,
      quoteSymbol: report.quote.symbol,
      dex: report.pair.dex,
      deployerAddress: report.launchOperator.address,
      fromBlock: report.blockRange.from,
      toBlock: report.blockRange.to,
      report: report as unknown as object,
    },
  });
}

export async function recalculateStored(analysisId: string, context: LaunchContext) {
  const row = await prisma.analysis.findUnique({ where: { id: analysisId } });
  if (!row?.report) throw new Error("This analysis has no stored report to recalculate.");
  const report = reclassifyReport(row.report as unknown as AnalysisReport, context);
  await prisma.analysis.update({ where: { id: analysisId }, data: { context: context as unknown as object } });
  await persistReport(analysisId, report);
  await audit("analysis.recalculated", "Classifications recomputed from stored trades", analysisId);
  return report;
}
