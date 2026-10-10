import { expect, test } from "@playwright/test";

test("home keeps the pair URL input visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /what happened to the pool/i })).toBeVisible();
  await expect(page.getByLabel(/DEXTools pair URL/i)).toBeVisible();
});

test("analyze accepts known external wallets without a team list", async ({ page }) => {
  await page.goto("/analyze");
  await expect(page.getByRole("heading", { name: /known external wallets/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /analyze launch/i })).toBeVisible();
  const teamRequired = page.getByText(/team wallets are required/i);
  await expect(teamRequired).toHaveCount(0);
});

test("methodology, history, compare, and settings all render", async ({ page }) => {
  const headings: Record<string, RegExp> = {
    "/methodology": /methodology and definitions/i,
    "/history": /historical reports/i,
    "/compare": /launch comparison/i,
    "/settings": /settings and api keys/i,
  };
  for (const [path, heading] of Object.entries(headings)) {
    const response = await page.goto(path);
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("an open report shows reserve evidence and does not claim an exact total price wipe", async ({ page, request }) => {
  const list = await request.get("/api/analyses");
  expect(list.ok()).toBeTruthy();
  const rows = (await list.json()) as { id: string; status: string; tokenSymbol?: string }[];
  const row = rows.find((item) => item.status === "completed" && item.tokenSymbol === "BARSTRO");
  test.skip(!row, "No completed BARSTRO report is stored in this database.");
  await page.goto(`/reports/${row!.id}`);
  await expect(page.getByText(/of the pre-swap spot price remained/i)).toBeVisible();
  await page.goto(`/reports/${row!.id}/diagnosis`);
  await expect(page.getByText(/of the prior price remained/i)).toBeVisible();
  await expect(page.getByText(/moved the spot price by -100\.0%/i)).toHaveCount(0);
});
