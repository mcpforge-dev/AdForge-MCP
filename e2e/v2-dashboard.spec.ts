import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./mock-api";

const legacyEmail =
  process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const legacyPassword =
  process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";

function collectClientFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("eval() is not supported in this environment") &&
      !message.text().includes("React will never use eval() in production mode")
    )
      failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("favicon")) return;
    failures.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  return failures;
}

async function login(page: Page) {
  await page.goto("/auth");
  await page.locator('input[name="email"]').fill(legacyEmail);
  await page.locator('input[name="password"]').fill(legacyPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("main.dashboard-shell")).toBeVisible();
}

test.describe("restored HolyMedia client UX", () => {
  test("direct auth modes and a new registration work", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await page.goto("/");
    await page.screenshot({
      path: testInfo.outputPath("landing.png"),
      fullPage: true,
    });
    await page.goto("/auth?mode=signup");
    await expect(
      page.getByRole("heading", { name: "Новый аккаунт" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Регистрация" }),
    ).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: testInfo.outputPath("registration.png"),
      fullPage: true,
    });

    const email = `playwright-${Date.now()}-${test.info().project.name}@example.test`;
    await page.locator('input[name="name"]').fill("Playwright User");
    await page.locator('input[name="email"]').fill(email);
    await page
      .locator('input[name="password"]')
      .fill("Playwright-password-123!");
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Реклама в вашем AI-чате" }),
    ).toBeVisible();
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("connections, account selection, MCP, reports and profile form a complete flow", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);

    await expect(page.getByText("Workspace", { exact: true })).toHaveCount(0);
    await expect(page.getByText("OWNER", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Тарифы/ })).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("dashboard.png"),
      fullPage: true,
    });

    await page.goto(
      "/dashboard?section=connections&oauth=success&provider=meta_ads",
    );
    await expect(
      page.getByText(
        "Платформа подключена. Откройте список кабинетов и выберите нужные.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meta Ads" })).toBeVisible();
    const metaCard = page
      .locator(".connection-card")
      .filter({ hasText: "Meta Ads" });
    await expect(metaCard.locator('input[type="checkbox"]')).toHaveCount(2);
    await metaCard.getByRole("button", { name: "Скрыть кабинеты" }).click();
    await expect(metaCard.locator('input[type="checkbox"]')).toHaveCount(0);
    await metaCard.getByRole("button", { name: "Посмотреть кабинеты" }).click();
    const checkedAccounts = metaCard.locator('input[type="checkbox"]:checked');
    if ((await checkedAccounts.count()) > 0) {
      await metaCard.getByRole("button", { name: "Снять все" }).click();
      const clearResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/provider-accounts/"),
      );
      await metaCard.getByRole("button", { name: "Сохранить выбор" }).click();
      expect((await clearResponse).ok()).toBeTruthy();
      await expect(checkedAccounts).toHaveCount(0);
    }
    await metaCard.getByRole("button", { name: "Выбрать все" }).click();
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/provider-accounts/"),
    );
    await metaCard.getByRole("button", { name: "Сохранить выбор" }).click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByText("Выбранные кабинеты сохранены.")).toBeVisible();
    await expect(checkedAccounts).toHaveCount(2);

    await metaCard.getByRole("button", { name: "Отключить" }).click();
    await expect(page.getByRole("dialog")).toContainText("Отключить Meta Ads?");
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("connections.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await expect(page.locator(".mcp-step .copy-row code").first()).toHaveText(
      "https://mcp.holymedia.kz/mcp",
    );
    await expect(page.getByRole("tab", { name: "Codex" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Claude" }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "Settings → Connectors",
    );

    const tokenForm = page.locator("form.token-form");
    await tokenForm.locator('input[name="name"]').fill("Playwright client");
    await tokenForm.getByRole("button", { name: "Создать ключ" }).click();
    await expect(page.locator(".one-time-secret")).toBeVisible();
    await expect(page.locator(".account-picker")).toHaveCount(0);
    await expect(page.locator(".scope-note")).toContainText(
      "выбранным кабинетам",
    );
    await expect(tokenForm.locator('input[name="name"]')).toHaveValue("");
    await expect(page.locator(".notice--error")).toHaveCount(0);
    await page.getByRole("button", { name: "Скрыть" }).click();
    await page.screenshot({
      path: testInfo.outputPath("mcp.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Отчёты", exact: true }).click();
    let reportUrl = "";
    await page.route("**/reports/performance.docx?**", async (route) => {
      reportUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: "PK-test",
      });
    });
    await page.locator('select[name="account_id"]').selectOption({ index: 1 });
    await page.locator('select[name="period"]').selectOption("14");
    await page.getByRole("button", { name: "Скачать отчёт" }).click();
    await expect.poll(() => reportUrl).not.toBe("");
    const reportParams = new URL(reportUrl).searchParams;
    expect(
      (new Date(reportParams.get("endDate")!).getTime() -
        new Date(reportParams.get("startDate")!).getTime()) /
        86_400_000,
    ).toBe(13);
    await page.screenshot({
      path: testInfo.outputPath("reports.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Анализ сайта", exact: true })
      .click();
    await page.locator('input[type="url"]').fill("https://example.com");
    await page.getByRole("button", { name: "Запустить анализ" }).click();
    await expect(
      page.getByRole("heading", { name: "https://example.com" }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: new RegExp(`Открыть профиль.*${legacyEmail}`),
      })
      .click();
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await expect(page.getByText("Подключено платформ")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("profile.png"),
      fullPage: true,
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("mobile navigation and connections do not overflow", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "mobile project only");
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);
    await page
      .getByRole("button", { name: "Подключения", exact: true })
      .click();
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      shell: document
        .querySelector("main.dashboard-shell")
        ?.getBoundingClientRect(),
      footer: document
        .querySelector("footer.footer--app")
        ?.getBoundingClientRect(),
      buttons: [...document.querySelectorAll("button")].map((button) => ({
        label: button.textContent?.trim(),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      })),
    }));
    expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.footer?.left).toBeCloseTo(layout.shell?.left ?? 0, 0);
    expect(layout.footer?.right).toBeCloseTo(layout.shell?.right ?? 0, 0);
    expect(
      layout.buttons.filter(
        (button) =>
          button.label &&
          button.width > 0 &&
          button.height > 0 &&
          button.height < 36,
      ),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("mobile-connections.png"),
      fullPage: true,
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
