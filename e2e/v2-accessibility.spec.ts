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
      if (
        message.type() === "error" &&
        !message
          .text()
          .includes("eval() is not supported in this environment") &&
        !message
          .text()
          .includes("React will never use eval() in production mode")
      ) {
        consoleErrors.push(message.text());
      }
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

  test("keeps the shared public shell localized and accessible", async ({
    page,
  }) => {
    await page.goto("/");
    const landingHeader = page.locator(".site-header");
    await expect(landingHeader).not.toHaveClass(/is-scrolled/);
    await page.evaluate(() => window.scrollTo(0, 240));
    await expect(landingHeader).toHaveClass(/is-scrolled/);
    expect(
      await landingHeader.evaluate(
        (element) => getComputedStyle(element).borderBottomWidth,
      ),
    ).toBe("0px");

    const footer = page.locator(".footer.footer--landing");
    const footerLeft = footer.locator(".footer__left");
    const footerLinks = footer.locator(".footer__links");
    await expect(footerLeft.locator(".footer__partner")).toBeVisible();
    await expect(footerLinks).toHaveCount(1);
    expect(
      await footerLeft.evaluate((element) => element.getBoundingClientRect().x),
    ).toBeCloseTo(
      await footer.evaluate((element) => element.getBoundingClientRect().x),
      0,
    );

    await page.goto("/privacy");
    const header = page.locator(".legal-header");
    await expect(header).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 240));
    expect(
      await header.evaluate((element) => element.getBoundingClientRect().top),
    ).toBeLessThanOrEqual(1);

    const legalFooter = page.locator("footer");
    await expect(
      legalFooter.getByRole("button", { name: "English" }),
    ).toHaveCount(0);
    await expect(
      legalFooter.locator(
        'a[href="https://astanahub.com/"] img.footer__partner-logo--dark-theme',
      ),
    ).toHaveAttribute("src", "/assets/astana-hub-dark.svg");
    await expect(
      legalFooter.locator(
        'a[href="https://astanahub.com/"] img.footer__partner-logo--light-theme',
      ),
    ).toHaveAttribute("src", "/assets/astana-hub-light.svg");

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { name: "HolyMedia MCP Privacy Policy" }),
    ).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/[А-Яа-яЁё]/);
    await expectAccessible(page, "privacy in English");

    await page.goto("/terms");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await page.locator("main").innerText()).not.toMatch(/[А-Яа-яЁё]/);
    await expectAccessible(page, "terms in English");
  });

  test("private customer sections", async ({ page }) => {
    await installMockApi(page);
    await login(page);
    await expectAccessible(page, "overview");
    for (const label of ["Подключения", "AI-клиент", "Отчёты"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expectAccessible(page, label);
      if (label === "Подключения") {
        const metaCard = page
          .locator(".connection-card")
          .filter({ hasText: "Meta Ads" });
        await metaCard
          .getByRole("button", { name: "Посмотреть кабинеты" })
          .click();
        await expectAccessible(page, "account selector dialog");
        await page.getByRole("button", { name: "Отмена" }).first().click();
      }
    }
    const siteAudit = page.getByRole("button", { name: /Анализ сайта/ });
    await expect(siteAudit).toBeEnabled();
    await siteAudit.click();
    await expectAccessible(page, "site audit brief");
    const seo = page.getByRole("button", { name: /SEO/ });
    await expect(seo).toBeDisabled();
    await expect(seo.locator("small")).toHaveText("Скоро");
    await page.getByRole("button", { name: "Тарифы", exact: true }).click();
    await expectAccessible(page, "tariffs");
    await page.getByRole("button", { name: /Открыть профиль/ }).click();
    await expectAccessible(page, "profile");
  });

  test("reports account picker is accessible", async ({ page }) => {
    await installMockApi(page);
    await login(page);
    await page.goto("/dashboard?section=reports");
    await expectAccessible(page, "reports without a selected account");
    await page.locator(".report-account-trigger").click();
    const picker = page.getByRole("dialog", {
      name: "Выберите рекламную платформу",
    });
    await expect(picker).toBeVisible();
    await expectAccessible(page, "reports platform picker");
    await picker.getByRole("button", { name: "Показать кабинеты" }).click();
    await expectAccessible(page, "reports account picker");
  });

  test("shows the shared feedback form without exposing technical terms", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    await login(page);
    const feedback = page.locator(".feedback-block");
    await expect(feedback).toBeVisible();
    await expect(feedback.locator('textarea[name="message"]')).toBeVisible();
    await expect(
      feedback.getByRole("button", { name: "Написать в поддержку" }),
    ).toBeVisible();
    await feedback.screenshot({ path: testInfo.outputPath("feedback.png") });
    await expectAccessible(page, "shared feedback");
  });
});
