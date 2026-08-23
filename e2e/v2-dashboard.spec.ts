import { expect, test, type Page } from "@playwright/test";

const legacyEmail =
  process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const legacyPassword =
  process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";

function collectClientFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    failures.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  return failures;
}

test.describe("V2 browser cutover smoke", () => {
  test("legacy login, workspace, providers, MCP, reports and billing surfaces", async ({
    page,
  }) => {
    const failures = collectClientFailures(page);

    await page.goto("/auth");
    await expect(page.locator("main.auth-shell")).toBeVisible();
    await page.locator('input[name="email"]').fill(legacyEmail);
    await page.locator('input[name="password"]').fill(legacyPassword);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("main.dashboard-shell")).toBeVisible();

    await expect(page.locator(".overview-lead")).toBeVisible();
    await expect(page.locator(".tabs-bar")).toContainText("Подключения");

    const workspaceSelect = page.locator("main.dashboard-shell select").first();
    await expect(workspaceSelect).toBeVisible();
    await expect(workspaceSelect.locator("option")).not.toHaveCount(0);

    const workspaceName = `Playwright workspace ${test.info().project.name}`;
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page
      .locator("form.inline-form")
      .first()
      .locator("input")
      .fill(workspaceName);
    const createWorkspaceResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/workspaces",
    );
    await page
      .locator("form.inline-form")
      .first()
      .locator('button[type="submit"]')
      .click();
    const workspaceResponse = await createWorkspaceResponse;
    const workspaceResponseBody = await workspaceResponse.text();
    expect(
      workspaceResponse.ok(),
      `workspace create failed: HTTP ${workspaceResponse.status()} ${workspaceResponseBody.slice(0, 500)}`,
    ).toBeTruthy();
    await expect(
      page.locator("form.inline-form").first().locator('input[name="name"]'),
    ).toHaveValue("");
    const createdWorkspaceOption = workspaceSelect
      .locator("option")
      .filter({ hasText: workspaceName });
    await expect(createdWorkspaceOption).toHaveCount(1);
    const createdWorkspaceValue =
      await createdWorkspaceOption.getAttribute("value");
    expect(createdWorkspaceValue).toBeTruthy();
    await workspaceSelect.selectOption(createdWorkspaceValue!);

    await page
      .getByRole("button", { name: "Подключения", exact: true })
      .click();
    await expect(page.locator(".connections-panel").first()).toBeVisible();
    await expect(page.locator("body")).toContainText("Meta onboarding");

    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await expect(page.locator("form.token-form")).toHaveCount(1);
    await expect(
      page.locator('form.token-form input[name="name"]'),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Отчёты", exact: true }).click();
    await expect(page.locator("#reports-title")).toBeVisible();
    await page
      .getByRole("button", { name: "Тариф и использование", exact: true })
      .click();
    await expect(page.locator("body")).toContainText("Тариф и использование");
    await expect(page.locator("header.dashboard-header button")).toHaveCount(1);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("new registration reaches the private dashboard", async ({ page }) => {
    const failures = collectClientFailures(page);
    const email = `playwright-${Date.now()}-${test.info().project.name}@example.test`;

    await page.goto("/auth");
    await page.locator(".tabs button").nth(1).click();
    await page.locator('input[name="name"]').fill("Playwright User");
    await page.locator('input[name="email"]').fill(email);
    await page
      .locator('input[name="password"]')
      .fill("Playwright-password-123!");
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("main.dashboard-shell")).toBeVisible();
    await expect(
      page.locator("main.dashboard-shell select").first().locator("option"),
    ).toHaveCount(1);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
