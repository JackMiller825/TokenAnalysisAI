import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../server/app.ts";
import { prisma } from "../server/db.ts";
import { queueConnection, workerConnection } from "../server/worker.ts";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await queueConnection.quit();
  await workerConnection.quit();
});

describe("analysis API validation", () => {
  it("answers health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.service).toBe("launchforensics");
    expect(body.postgres).toBe("ok");
  });

  it("rejects an unsupported pair URL before queueing work", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: { url: "https://www.dextools.io/app/bnb/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650" },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("rejects a malformed external wallet", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: { url: "https://www.dextools.io/app/ether/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650", context: { externalWallets: [{ address: "0x123" }] } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/address/i);
  });
});
