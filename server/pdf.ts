import PDFDocument from "pdfkit";
import type { AnalysisReport } from "../shared/types.ts";
import { formatRaw } from "../engine/format.ts";

export function renderPdf(report: AnalysisReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const q = report.quote.symbol;
    const dec = report.quote.decimals;
    const heading = (text: string) => {
      doc.moveDown(0.8);
      doc.fontSize(14).fillColor("#083344").text(text);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#111827");
    };
    doc.fontSize(22).fillColor("#083344").text("LaunchForensics");
    doc.moveDown(0.3);
    doc.fontSize(16).text(`${report.token.symbol} / ${q} launch report`);
    doc.fontSize(10).fillColor("#374151");
    doc.moveDown(0.6);
    doc.text(`Generated ${report.generatedAt}`);
    doc.text(`Chain ${report.chainId} · blocks ${report.blockRange.from ?? "—"}–${report.blockRange.to ?? "—"}`);
    doc.text(`Pair ${report.pair.address}`);
    doc.text(`Token ${report.token.address}`);
    doc.text(`Analysis version ${report.version}`);
    doc.text(`Providers: ${report.providers.join(", ")}`);
    doc.text(`ETH/USD: ${report.ethUsd.source}${report.ethUsd.price ? ` (${report.ethUsd.price})` : ""}`);
    doc.text(`Completeness: ${report.completeness.map((item) => `${item.label}=${item.state}`).join("; ")}`);
    heading("Executive summary");
    doc.text(report.narrative.executive, { align: "left" });
    heading("Launch snapshot");
    doc.text(`Initial liquidity: ${formatRaw(report.launch.initialWethRaw, dec, 8)} ${q}`);
    doc.text(`Final reserve: ${formatRaw(report.launch.finalWethRaw, dec, 12)} ${q} and ${formatRaw(report.launch.finalTokenRaw, report.token.decimals, 4)} ${report.token.symbol}`);
    doc.text(`Swaps: ${report.summary.swaps} (${report.summary.buys} buys / ${report.summary.sells} sells)`);
    doc.text(`Unique buy addresses: ${report.summary.uniqueBuyers}`);
    doc.text(`Launch operator: ${report.launchOperator.address ?? "not identified"}`);
    heading("Timeline");
    doc.text(report.narrative.timeline);
    heading("Trading and wallets");
    doc.text(report.narrative.organic);
    doc.text(`Known-external buy volume: ${formatRaw(report.external.knownExternalBuyWethRaw, dec, 6)} ${q}`);
    doc.text(`Known-external net flow: ${formatRaw(report.external.knownExternalNetFlowRaw, dec, 6)} ${q}`);
    heading("WETH accounting");
    doc.text(report.flows.note);
    doc.text(`Expected ending: ${formatRaw(report.flows.expectedFinalWethRaw, dec, 8)} ${q}`);
    doc.text(`Last sync: ${formatRaw(report.flows.syncFinalWethRaw, dec, 12)} ${q}`);
    heading("Liquidity");
    doc.text(report.liquidity.explanation);
    doc.text(report.liquidity.lock.detail);
    heading("Contract and security");
    doc.text(report.security.verificationSource);
    doc.text(report.security.safetyNote);
    doc.text(report.security.honeypot.detail);
    heading("Strengths");
    for (const item of report.worked) doc.text(`• ${item.title} (${item.confidence}). ${item.summary}`);
    if (!report.worked.length) doc.text("None cleared the evidence thresholds.");
    heading("Weaknesses");
    for (const item of report.failed) doc.text(`• ${item.title} (${item.confidence}). ${item.summary}`);
    heading("Root cause");
    for (const item of report.failed) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").text(item.title);
      doc.font("Helvetica").text(item.whatHappened);
      doc.text(`Mechanism: ${item.mechanism}`);
      doc.text(`Effect: ${item.effect}`);
      doc.text(`Unknown: ${item.unknown}`);
    }
    heading("Recommendations");
    for (const item of report.recommendations) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").text(`${item.priority.toUpperCase()}: ${item.problem}`);
      doc.font("Helvetica").text(item.action);
      doc.text(`Verification: ${item.verification}`);
      doc.text(`Expected outcome: ${item.expectedOutcome}`);
    }
    heading("Methodology and limitations");
    for (const item of report.limitations) doc.text(`• ${item}`);
    for (const score of report.scores) doc.text(`${score.label}: ${score.status === "scored" ? score.score : "Not Assessed"}. ${score.formula}`);
    doc.text(report.overall.disclaimer);
    heading("Supporting transactions");
    const refs = [
      report.launch.firstLiquidityTx,
      report.launch.firstSwapTx,
      report.launch.ath.txHash,
      report.launch.firstMajorSellTx,
      ...report.sellers.slice(0, 8).map((seller) => seller.largestTxHash),
    ].filter(Boolean);
    for (const hash of [...new Set(refs)]) doc.text(`https://etherscan.io/tx/${hash}`);
    doc.end();
  });
}
