import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installMockApi } from "./mock-api";

const email = process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const password = process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/auth");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("feedback form saves a support request and exposes it in admin support", async ({
  page,
}) => {
  const adminPassword = "test-admin-password";
  await installMockApi(page, { adminPassword });
  await login(page);

  const feedback = page.locator(".feedback-block");
  await expect(feedback).toBeVisible();
  expect(
    await new AxeBuilder({ page }).include(".feedback-block").analyze(),
  ).toEqual(expect.objectContaining({ violations: [] }));
  await feedback
    .locator('textarea[name="message"]')
    .fill("Mobile account selection needs more space.");
  await feedback.locator('button[type="submit"]').click();
  await expect(feedback.getByRole("status")).toBeVisible();
  await expect(feedback.locator('textarea[name="message"]')).toHaveValue("");

  await page.goto("/admin?section=support");
  const loginInput = page.locator('input[name="login"]');
  if (await loginInput.isVisible()) {
    await loginInput.fill("Admin");
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
  }
  await expect(page.locator(".admin-content")).toContainText(
    "Mobile account selection needs more space.",
  );
  await expect(page.locator(".admin-content")).toContainText("HolyMedia");
});
