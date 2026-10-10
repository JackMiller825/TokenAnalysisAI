-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressDetail" TEXT NOT NULL DEFAULT '',
    "workCompleted" INTEGER NOT NULL DEFAULT 0,
    "workTotal" INTEGER NOT NULL DEFAULT 0,
    "indeterminate" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "chainId" INTEGER NOT NULL DEFAULT 1,
    "sourceUrl" TEXT NOT NULL,
    "pairAddress" TEXT NOT NULL,
    "tokenAddress" TEXT,
    "quoteAddress" TEXT,
    "tokenSymbol" TEXT,
    "quoteSymbol" TEXT,
    "dex" TEXT,
    "deployerAddress" TEXT,
    "fromBlock" INTEGER,
    "toBlock" INTEGER,
    "idempotencyKey" TEXT,
    "context" JSONB NOT NULL,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "side" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tokenRaw" TEXT NOT NULL,
    "wethRaw" TEXT NOT NULL,
    "priceAfter" TEXT NOT NULL,
    "immediateImpact" DOUBLE PRECISION,
    "reserveTokenRaw" TEXT NOT NULL,
    "reserveWethRaw" TEXT NOT NULL,
    "method" TEXT,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedWallet" (
    "address" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedWallet_pkey" PRIMARY KEY ("address","role")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "rpcUrls" TEXT NOT NULL DEFAULT '',
    "etherscanApiKey" TEXT NOT NULL DEFAULT '',
    "aiBaseUrl" TEXT NOT NULL DEFAULT '',
    "aiApiKey" TEXT NOT NULL DEFAULT '',
    "aiModel" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Analysis_status_createdAt_idx" ON "Analysis"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Analysis_pairAddress_idx" ON "Analysis"("pairAddress");

-- CreateIndex
CREATE INDEX "Analysis_idempotencyKey_idx" ON "Analysis"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Trade_analysisId_timestamp_idx" ON "Trade"("analysisId", "timestamp");

-- CreateIndex
CREATE INDEX "Trade_analysisId_actor_idx" ON "Trade"("analysisId", "actor");

-- CreateIndex
CREATE INDEX "Trade_analysisId_category_idx" ON "Trade"("analysisId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_analysisId_txHash_logIndex_key" ON "Trade"("analysisId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "AuditLog_analysisId_createdAt_idx" ON "AuditLog"("analysisId", "createdAt");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

