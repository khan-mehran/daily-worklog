import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("sends signed-out visitors to the login page", async ({ page }) => {
  await page.goto("/departments");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdepartments/);
});

test("the sign-in page offers Microsoft and nothing else", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Sign in with Microsoft" })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveCount(0);
});

test("someone waiting for approval is told so on the sign-in page", async ({ page }) => {
  await page.goto("/login?status=pending");
  await expect(page.getByText("Waiting for approval")).toBeVisible();
  await expect(page.getByText("as soon as they approve it")).toBeVisible();
  await page.goto("/login?status=rejected");
  await expect(page.getByText("Access not approved")).toBeVisible();
});

test("a Super Admin approves a waiting person with a role, department and Team Lead", async ({ page }) => {
  await signIn(page, "admin@getl.demo");
  await page.goto("/users");
  await expect(page.getByText("1 person is waiting for approval.")).toBeVisible();

  const row = page.getByRole("row", { name: /Nadia Haddad/ });
  await expect(row.getByText("Waiting for approval")).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Department", { exact: true }).click();
  await page.getByRole("option", { name: "IT" }).click();
  await dialog.getByLabel("Reports to").click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("button", { name: "Approve" }).click();

  await expect(page.getByText("Nadia Haddad can now sign in.")).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();
  await expect(row.getByText("Developer")).toBeVisible();
  await expect(page.getByText("is waiting for approval.")).toHaveCount(0);
});

test("the CEO can switch departments and add one with a new manager", async ({ page }) => {
  await signIn(page, "ceo@getl.demo");
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
  await page.getByLabel("Work email").fill(`nour.${Date.now()}@getl.demo`);
  await page.getByRole("button", { name: "Create department" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("heading", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Nour Hassan").first()).toBeVisible();
});

test("a department manager sees only their own department", async ({ page }) => {
  await signIn(page, "manager.it@getl.demo");
  await expect(page.getByRole("combobox", { name: "Department filter" })).toHaveCount(0);
  await expect(page.locator("header").getByText("IT", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Departments" })).toHaveCount(0);

  const response = await page.goto("/departments");
  expect(response?.status()).toBe(404);

  const departments = await page.request.get("/api/departments");
  const { data } = await departments.json();
  expect(data.map((department: { code: string }) => department.code)).toEqual(["IT"]);
});

test("a developer has no team, reviews, users or departments pages", async ({ page }) => {
  await signIn(page, "dev1.it@getl.demo");
  for (const path of ["/team", "/reviews", "/users", "/departments"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("the theme choice applies and is saved to the account", async ({ page }) => {
  await signIn(page, "lead1.it@getl.demo");
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 17, 22)");

  await expect
    .poll(async () => (await (await page.request.get("/api/me")).json()).data.preferences.theme)
    .toBe("dark");
});
