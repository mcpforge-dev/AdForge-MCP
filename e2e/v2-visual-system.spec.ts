import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./mock-api";

const email = process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const password = process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";

async function login(page: Page) {
  await page.goto("/auth");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /Войти/ }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectNoAxeViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations,
    `${context}: ${results.violations.map((violation) => violation.id).join(", ")}`,
  ).toEqual([]);
}

test.describe("visual system", () => {
  test("applies the saved theme before first interactive paint and persists it", async ({
    page,
  }, testInfo) => {
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
    await page.addInitScript(() => {
      if (!localStorage.getItem("holymedia-theme")) {
        localStorage.setItem("holymedia-theme", "light");
      }
    });
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".app-loader")).toHaveAttribute(
      "data-loader-visible",
      "true",
    );
    await page.screenshot({ path: testInfo.outputPath("loader-light.png") });
    await expect(page.locator(".app-loader")).toHaveAttribute(
      "data-loader-visible",
      "false",
    );

    const themeControl = page.getByRole("group", { name: "Theme" });
    await themeControl.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-preference",
      "dark",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-preference",
      "dark",
    );
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await page.screenshot({
      path: testInfo.outputPath("theme-switcher-dark.png"),
    });
    expect(consoleErrors).toEqual([]);
  });

  test("keeps cursor desktop-only and leaves text inputs native", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    const isFinePointer = await page.evaluate(
      () => window.matchMedia("(pointer: fine) and (hover: hover)").matches,
    );
    if (isFinePointer) {
      const cursor = page.locator(".brand-cursor");
      await expect(cursor).toBeVisible();
      await page.mouse.move(160, 160);
      await expect(cursor.locator(".brand-cursor__dot")).not.toHaveCSS(
        "transform",
        "none",
      );
      await page.locator('a[href="/auth"]').first().hover();
      await expect(page.locator("html")).toHaveClass(
        /brand-cursor--interactive/,
      );
      await page.goto("/auth");
      await page.locator('input[name="email"]').hover();
      await expect(page.locator("html")).toHaveClass(/brand-cursor--text/);
      await page.screenshot({
        path: testInfo.outputPath("desktop-cursor.png"),
      });
    } else {
      await expect(page.locator(".brand-cursor")).toHaveCount(0);
    }
  });

  test("renders light and dark public/private surfaces without axe violations", async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("holymedia-theme")) {
        localStorage.setItem("holymedia-theme", "light");
      }
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".app-loader")).toHaveAttribute(
      "data-loader-visible",
      "false",
    );
    await expectNoAxeViolations(page, "light landing");
    await page.screenshot({
      path: testInfo.outputPath("light-landing.png"),
      fullPage: true,
    });

    await installMockApi(page);
    await login(page);
    await page.goto("/dashboard?section=connections");
    await page.screenshot({
      path: testInfo.outputPath("light-connections.png"),
      fullPage: true,
    });
    await page.goto("/dashboard?section=reports", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".report-account-trigger")).toBeVisible();
    await expectNoAxeViolations(page, "light reports");
    await page.locator(".report-account-trigger").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoAxeViolations(page, "light reports modal");
    await page.screenshot({
      path: testInfo.outputPath("light-reports-modal.png"),
      fullPage: true,
    });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator(".report-account-trigger").click();
    await expectNoAxeViolations(page, "dark reports modal");
    await page.screenshot({
      path: testInfo.outputPath("dark-reports-modal.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.goto("/dashboard");
    await page.screenshot({
      path: testInfo.outputPath("dark-dashboard.png"),
      fullPage: true,
    });
    await page.goto("/dashboard?section=connections");
    await page.screenshot({
      path: testInfo.outputPath("dark-connections.png"),
      fullPage: true,
    });
    await page.goto("/");
    await expect(page.locator(".app-loader")).toHaveAttribute(
      "data-loader-visible",
      "false",
    );
    await page.screenshot({
      path: testInfo.outputPath("dark-landing.png"),
      fullPage: true,
    });
  });

  test("renders the protected admin shell in both themes", async ({
    page,
  }, testInfo) => {
    const adminPassword = randomUUID();
    await page.addInitScript(() =>
      localStorage.setItem("holymedia-theme", "light"),
    );
    await installMockApi(page, { adminPassword });
    await page.goto("/admin");
    const adminLogin = page.locator('input[name="login"]');
    if (!(await adminLogin.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /Выйти/ }).click();
    }
    await adminLogin.fill("Admin");
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: /Войти/ }).click();
    await expect(page.locator(".admin-shell")).toBeVisible();
    await expectNoAxeViolations(page, "light admin");
    await page.screenshot({
      path: testInfo.outputPath("light-admin.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectNoAxeViolations(page, "dark admin");
    await page.screenshot({
      path: testInfo.outputPath("dark-admin.png"),
      fullPage: true,
    });
  });

  test("respects reduced motion and touch cursor behavior", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    await expect(page.locator(".app-loader")).toHaveAttribute(
      "data-loader-visible",
      "false",
    );
    const isCoarsePointer = await page.evaluate(
      () => window.matchMedia("(pointer: coarse)").matches,
    );
    if (isCoarsePointer)
      await expect(page.locator(".brand-cursor")).toHaveCount(0);
  });
});
