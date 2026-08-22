import { chromium } from "@playwright/test";

const baseUrl =
  process.env.PHASE_C_BROWSER_BASE_URL ?? "https://mcp.holymedia.kz";
const email = "phase-c-browser-smoke@example.invalid";
const password = "Phase-C-browser-smoke-123!";
const browser = await chromium.launch({ headless: true });
const results = [];
const viewports = process.env.PHASE_C_BROWSER_SINGLE_VIEWPORT
  ? [["desktop", 1440, 900]]
  : [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ];

for (const [index, [name, width, height]] of viewports.entries()) {
  const page = await browser.newPage({ viewport: { width, height } });
  const failures = [];
  const authResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push("console");
  });
  page.on("requestfailed", () => failures.push("request"));
  page.on("response", async (response) => {
    if (response.url().includes("/api/v1/auth/")) {
      authResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page
    .locator(".tabs button")
    .nth(index === 0 ? 1 : 0)
    .click();
  if (index === 0)
    await page.locator('input[name="name"]').fill("Phase C Smoke");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  try {
    await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 });
    await page
      .locator("main.dashboard-shell select")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await page
      .getByText("Billing", { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "failed",
        viewport: name,
        url: page.url(),
        authResponses,
        body: (await page.locator("body").innerText()).slice(0, 500),
      }),
    );
    throw error;
  }
  results.push({
    viewport: name,
    dashboard: await page.locator("main.dashboard-shell").count(),
    workspaceOptions: await page
      .locator("main.dashboard-shell select")
      .first()
      .locator("option")
      .count(),
    billingVisible: await page.locator("body").getByText("Billing").count(),
    clientFailures: failures.length,
  });
  await page.close();
}

await browser.close();
if (
  results.some(
    (result) =>
      result.dashboard !== 1 ||
      result.workspaceOptions < 1 ||
      result.billingVisible < 1 ||
      result.clientFailures !== 0,
  )
) {
  console.error(JSON.stringify({ status: "failed", results }));
  process.exit(1);
}
console.log(JSON.stringify({ status: "passed", results }));
