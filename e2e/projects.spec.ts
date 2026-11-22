import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("a manager creates a project, and only the assigned developer sees it", async ({
  page,
  browser,
}) => {
  const stamp = String(Date.now()).slice(-6);
  const name = `Audit Tool ${stamp}`;

  await signIn(page, "manager.it@getl.demo");
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Code", { exact: true }).fill(`A${stamp}`);
  await page.getByLabel("Search people in this department").fill("Arjun");
  await page.getByRole("checkbox", { name: /Arjun Mehta/ }).check();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const projectPath = new URL(page.url()).pathname;

  const assigned = await (await browser.newContext()).newPage();
  await signIn(assigned, "dev1.it@getl.demo");
  await assigned.goto("/projects");
  await expect(assigned.getByRole("heading", { name })).toBeVisible();
  await expect(assigned.getByRole("button", { name: "Add project" })).toHaveCount(0);

  const unassigned = await (await browser.newContext()).newPage();
  await signIn(unassigned, "dev2.it@getl.demo");
  await unassigned.goto("/projects");
  await expect(unassigned.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(unassigned.getByRole("heading", { name })).toHaveCount(0);
  expect((await unassigned.goto(projectPath))?.status()).toBe(404);

  const otherDepartment = await (await browser.newContext()).newPage();
  await signIn(otherDepartment, "manager.hr@getl.demo");
  expect((await otherDepartment.goto(projectPath))?.status()).toBe(404);
});

test("the CEO sees every department's projects but can't change them", async ({ page }) => {
  await signIn(page, "ceo@getl.demo");
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Q4 Hiring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Department filter" }).click();
  await page.getByRole("option", { name: "Marketing" }).click();
  await expect(page.getByRole("heading", { name: "Autumn Campaign" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Q4 Hiring" })).toHaveCount(0);

  await page.getByRole("heading", { name: "Autumn Campaign" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Only fully approved reports count.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage members" })).toHaveCount(0);
});

test("a team lead edits a project and changes its members", async ({ page }) => {
  await signIn(page, "lead1.it@getl.demo");
  await page.goto("/projects");
  await page.getByRole("heading", { name: "Client Portal" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "On hold" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("main").getByText("On hold")).toBeVisible();

  await page.getByRole("button", { name: "Manage members" }).click();
  await page.getByLabel("Search people in this department").fill("Tomás");
  await page.getByRole("checkbox", { name: /Tomás Rivera/ }).click();
  await page.getByRole("button", { name: "Save members" }).click();
  await expect(page.getByText("Members updated.")).toBeVisible();
});
