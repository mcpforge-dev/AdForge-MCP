import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./mock-api";

const email = process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const password = process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";

async function expectAccessible(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations,
    `${context}: ${results.violations
      .map((violation) => `${violation.id} (${violation.nodes.length})`)
      .join(", ")}`,
  ).toEqual([]);
}

async function login(page: Page) {
  await page.goto("/auth");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("axe accessibility", () => {
  test("starts in Russian without a translation observer loop", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(
      page.getByRole("heading", { name: /Вся ваша реклама.*AI-чате/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "All your advertising in one AI chat",
      }),
    ).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(consoleErrors).toEqual([]);

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "English" })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", {
        name: "All your advertising in one AI chat",
      }),
    ).toBeVisible();
  });

  test("public authentication and legal pages", async ({ page }) => {
    for (const path of [
      "/",
      "/auth",
      "/auth?mode=signup",
      "/privacy",
      "/terms",
    ]) {
      await page.goto(path);
      await expectAccessible(page, path);
    }
  });

  test("private customer sections", async ({ page }) => {
    await installMockApi(page);
    await login(page);
    await expectAccessible(page, "overview");
    for (const label of [
      "Подключения",
      "AI-клиент",
      "Отчёты",
      "Анализ сайта",
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expectAccessible(page, label);
    }
    await page.getByRole("button", { name: /Открыть профиль/ }).click();
    await expectAccessible(page, "profile");
  });
});
