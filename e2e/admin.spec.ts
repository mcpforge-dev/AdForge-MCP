import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./mock-api";

function failures(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("eval() is not supported in this environment") &&
      !message.text().includes("React will never use eval()")
    )
      errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED")
      errors.push(`${request.method()} ${request.url()}`);
  });
  return errors;
}

test.describe("owner admin console", () => {
  test("keeps customer access out and activates a pending company through the protected flow", async ({
    page,
  }, testInfo) => {
    const adminPassword = randomUUID();
    await installMockApi(page, { adminPassword });
    const clientFailures = failures(page);
    await page.goto("/admin");
    await openLogin(page);
    await page.locator('input[name="login"]').fill("admin");
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
    await page.getByRole("button", { name: "На проверке" }).click();
    await expect(page.getByRole("heading", { name: "Компании" })).toBeVisible();
    await page.getByRole("button", { name: "Открыть" }).click();
    const drawer = page.getByRole("dialog", { name: "HolyMedia" });
    await expect(drawer).toContainText("Юр. наименование");
    await drawer.getByRole("button", { name: "Активировать" }).click();
    await expect(
      page.getByRole("dialog", { name: "Активировать компанию?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(drawer.getByText("ACTIVE", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("admin-company.png"),
      fullPage: true,
    });
    expect(clientFailures, clientFailures.join("\n")).toEqual([]);
  });

  test("works on mobile without layout overflow", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "mobile project only");
    const adminPassword = randomUUID();
    await installMockApi(page, { adminPassword });
    await page.goto("/admin");
    await openLogin(page);
    await page.locator('input[name="login"]').fill("admin");
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await page.getByRole("button", { name: "Диагностика" }).click();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.screenshot({
      path: testInfo.outputPath("admin-mobile.png"),
      fullPage: true,
    });
  });

  test("has no serious accessibility regressions", async ({ page }) => {
    const adminPassword = randomUUID();
    await installMockApi(page, { adminPassword });
    await page.goto("/admin");
    await openLogin(page);
    await page.locator('input[name="login"]').fill("admin");
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

async function openLogin(page: Page) {
  const login = page.locator('input[name="login"]');
  if (!(await login.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Выйти" }).click();
  }
  await expect(login).toBeVisible();
}
