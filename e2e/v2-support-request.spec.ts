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
  await feedback.locator(".feedback-block__form button[type=submit]").click();
  const successDialog = page.getByRole("dialog", {
    name: "Спасибо, сообщение отправлено",
  });
  await expect(successDialog).toBeVisible();
  await expect(successDialog).toContainText(
    "Мы получили вашу заявку и вернёмся с ответом.",
  );
  await expect(
    successDialog.getByRole("button", { name: "Хорошо" }),
  ).toBeFocused();
  expect(
    await new AxeBuilder({ page })
      .include(".feedback-success-dialog")
      .analyze(),
  ).toEqual(expect.objectContaining({ violations: [] }));
  await expect(feedback.locator('textarea[name="message"]')).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(successDialog).toBeHidden();

  await feedback
    .locator('textarea[name="message"]')
    .fill("The feedback form now confirms delivery.");
  await feedback.locator(".feedback-block__form button[type=submit]").click();
  await expect(successDialog).toBeVisible();
  await successDialog.getByRole("button", { name: "Хорошо" }).click();
  await expect(successDialog).toBeHidden();
  await expect(feedback.locator('textarea[name="message"]')).toHaveValue("");

  await page.goto("/admin?section=support");
  const loginInput = page.locator('input[name="login"]');
  if (await loginInput.isVisible()) {
    await loginInput.fill("Admin");
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
  }
  await expect(page.locator(".admin-content")).toContainText(
    "The feedback form now confirms delivery.",
  );
  await expect(page.locator(".admin-content")).toContainText("HolyMedia");
});

test("feedback success is withheld without an explicit Telegram delivery confirmation", async ({
  page,
}) => {
  await installMockApi(page);
  await login(page);
  await page.route("**/api/v1/workspaces/*/support-requests", async (route) => {
    await route.fulfill({
      status: 201,
      headers: {
        "access-control-allow-origin": "http://localhost:3000",
        "access-control-allow-credentials": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({ request: { id: "unconfirmed" }, created: true }),
    });
  });

  const feedback = page.locator(".feedback-block");
  await feedback
    .locator('textarea[name="message"]')
    .fill("Do not confirm without Telegram delivery.");
  await feedback.locator(".feedback-block__form button[type=submit]").click();

  await expect(
    page.getByRole("dialog", { name: "Спасибо, сообщение отправлено" }),
  ).toBeHidden();
  await expect(feedback.getByRole("alert")).toBeVisible();
});

test("feedback validates a short message before calling the API", async ({
  page,
}) => {
  await installMockApi(page);
  await login(page);
  let supportRequests = 0;
  await page.route("**/api/v1/workspaces/*/support-requests", async (route) => {
    supportRequests += 1;
    await route.abort();
  });

  const feedback = page.locator(".feedback-block");
  const message = feedback.locator('textarea[name="message"]');
  await message.fill("Я");
  await feedback.locator(".feedback-block__form button[type=submit]").click();

  await expect(feedback.getByRole("alert")).toContainText(
    "Введите не менее 3 символов.",
  );
  await expect(message).toBeFocused();
  await expect(message).toHaveAttribute("aria-invalid", "true");
  expect(supportRequests).toBe(0);

  await message.fill("Всё работает");
  await expect(feedback.getByRole("alert")).toBeHidden();
  await expect(message).not.toHaveAttribute("aria-invalid", "true");
});
