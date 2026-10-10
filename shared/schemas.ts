import { z } from "zod";

export const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Enter a 20-byte Ethereum address.");

export const walletInputSchema = z.object({
  address: addressSchema,
  label: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(400).optional().default(""),
});

export const launchContextSchema = z.object({
  externalWallets: z.array(walletInputSchema).max(500).default([]),
  teamWallets: z.array(walletInputSchema).max(500).default([]),
  botWallets: z.array(walletInputSchema).max(500).default([]),
  assumptionTreatUnlistedAsTeam: z.boolean().default(false),
  initialLiquidityNote: z.string().trim().max(400).default(""),
  marketingSpendNote: z.string().trim().max(400).default(""),
  launchTimingNote: z.string().trim().max(400).default(""),
  communitySizeNote: z.string().trim().max(400).default(""),
  website: z.string().trim().max(300).default(""),
  socials: z.string().trim().max(800).default(""),
  campaignNotes: z.string().trim().max(2000).default(""),
  teamTradeNotes: z.string().trim().max(2000).default(""),
});

export const createAnalysisSchema = z.object({
  url: z.string().trim().min(3).max(500),
  context: launchContextSchema.optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

export const updateContextSchema = z.object({
  context: launchContextSchema,
  recalculate: z.boolean().optional().default(true),
});

export const settingsSchema = z.object({
  rpcUrls: z.string().max(2000).optional().default(""),
  etherscanApiKey: z.string().max(200).optional(),
  aiBaseUrl: z.string().max(300).optional(),
  aiApiKey: z.string().max(300).optional(),
  aiModel: z.string().max(120).optional(),
});

export const simulateSchema = z.object({
  initialWeth: z.number().positive().max(1_000_000),
  initialTokens: z.number().positive(),
  tokenDecimals: z.number().int().min(0).max(36).default(18),
  buys: z.array(z.number().positive()).max(50).default([]),
  sells: z.array(z.number().positive()).max(50).default([]),
});

export const savedWalletSchema = z.object({
  address: addressSchema,
  role: z.enum(["external", "team", "bot"]),
  label: z.string().max(80).optional().default(""),
  notes: z.string().max(400).optional().default(""),
});
