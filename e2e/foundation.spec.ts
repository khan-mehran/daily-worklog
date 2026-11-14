import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "WorkLog!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("sends signed-out visitors to the login page", async ({ page }) => {
  await page.goto("/departments");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdepartments/);
});

test("rejects a wrong password with a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("dev2.acc@worklog.demo");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("don't match")).toBeVisible();
});

test("the CEO can switch departments and add one with a new manager", async ({ page }) => {
  await signIn(page, "ceo@worklog.demo");
  await expect(page.getByRole("link", { name: "Departments" }).first()).toBeVisible();

  await page.getByRole("combobox", { name: "Department filter" }).click();
  await page.getByRole("option", { name: "HR" }).click();
  await expect(page.getByText("CEO · HR.", { exact: false })).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Q4 Hiring" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Client Portal" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Department filter" }).click();
  await page.getByRole("option", { name: "All departments" }).click();
  await expect(page.getByRole("heading", { name: "Client Portal" })).toBeVisible();

  await page.goto("/departments");
  await expect(page.getByRole("heading", { name: "Marketing" })).toBeVisible();

  const name = `Legal ${Date.now()}`;
  await page.getByRole("button", { name: "Add department" }).click();
  await page.getByLabel("Department name").fill(name);
  await page.getByLabel("Code", { exact: true }).fill(`L${String(Date.now()).slice(-6)}`);
  await page.getByRole("radio", { name: "Invite a new one" }).click();
  await page.getByLabel("Full name").fill("Nour Hassan");
  await page.getByLabel("Work email").fill(`nour.${Date.now()}@worklog.demo`);
  await page.getByRole("button", { name: "Create department" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("heading", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Nour Hassan").first()).toBeVisible();
});

test("a department manager sees only their own department", async ({ page }) => {
  await signIn(page, "manager.it@worklog.demo");
  await expect(page.getByRole("combobox", { name: "Department filter" })).toHaveCount(0);
  await expect(page.locator("header").getByText("IT", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Departments" })).toHaveCount(0);

  const response = await page.goto("/departments");
  expect(response?.status()).toBe(404);

  const departments = await page.request.get("/api/departments");
  const { data } = await departments.json();
  expect(data.map((department: { code: string }) => department.code)).toEqual(["IT"]);
});

test("a developer has no team, reviews or admin pages", async ({ page }) => {
  await signIn(page, "dev1.it@worklog.demo");
  for (const path of ["/team", "/reviews", "/admin", "/departments"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("the theme choice applies and is saved to the account", async ({ page }) => {
  await signIn(page, "lead1.it@worklog.demo");
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 17, 22)");

  await expect
    .poll(async () => (await (await page.request.get("/api/me")).json()).data.preferences.theme)
    .toBe("dark");
});
