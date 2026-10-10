import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function audit(action: string, message: string, analysisId?: string) {
  await prisma.auditLog.create({ data: { action, message, analysisId: analysisId ?? null } });
}
