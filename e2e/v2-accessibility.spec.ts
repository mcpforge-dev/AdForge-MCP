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
