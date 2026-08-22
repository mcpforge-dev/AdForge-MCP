import { chromium } from "@playwright/test";

const baseUrl =
  process.env.PHASE_C_BROWSER_BASE_URL ?? "https://mcp.holymedia.kz";
const browser = await chromium.launch({ headless: true });
const results = [];

for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push("console");
  });
  page.on("requestfailed", () => failures.push("request"));

  const auth = await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  const authShell = await page.locator("main.auth-shell").count();
  const root = await page.goto(baseUrl, { waitUntil: "networkidle" });
  results.push({
    viewport: name,
    authStatus: auth?.status() ?? null,
    authShell,
    rootStatus: root?.status() ?? null,
    clientFailures: failures.length,
  });
  await page.close();
}

await browser.close();
if (
  results.some(
    (result) =>
      result.authStatus !== 200 ||
      result.authShell !== 1 ||
      result.rootStatus !== 200 ||
      result.clientFailures !== 0,
  )
) {
  console.error(JSON.stringify({ status: "failed", results }));
  process.exit(1);
}
console.log(JSON.stringify({ status: "passed", results }));
