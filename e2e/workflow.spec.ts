import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "WorkLog!2026";

async function signedIn(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  return page;
}

async function openCurrentWeekFromReviews(page: Page, owner: string) {
  await page.goto("/reviews");
  await page.getByRole("link", { name: new RegExp(owner) }).first().click();
  await page.waitForURL(/\/reports\/[a-f\d]{24}$/);
  return new URL(page.url()).pathname;
}

// The seed leaves each department's first developer with an open week, which this test submits.
test("a week goes from developer to Team Lead to Manager, and back with requested changes", async ({ browser }) => {
  const details = `Wrote the release checklist ${Date.now()}`;

  const dev = await signedIn(browser, "dev1.it@worklog.demo");
  await dev.goto("/tasks");
  // Wait for hydration, so the shortcut listener is attached before N is pressed.
  await dev.waitForLoadState("networkidle");
  await dev.keyboard.press("n");
  await expect(dev.getByRole("dialog", { name: "Add task" })).toBeVisible();
  await dev.getByRole("combobox", { name: "Project" }).click();
  await dev.getByRole("option").first().click();
  await dev.getByLabel("Task details").fill(details);

  // No API key in the test environment: the assistant says so, and saving still works.
  await dev.getByRole("button", { name: "Improve with AI" }).click();
  await expect(dev.getByText("You can still save what you wrote.")).toBeVisible();
  await dev.getByLabel("Hours").fill("2.5");
  await dev.getByRole("button", { name: "Add task" }).click();
  await expect(dev.getByText(details)).toBeVisible();

  await dev.getByRole("tab", { name: "Weekly" }).click();
  await dev.getByRole("button", { name: "Submit week" }).first().click();
  await dev.getByRole("dialog").getByRole("button", { name: "Submit week" }).click();
  await expect(dev.getByText(/submitted\. Your approver has been notified/)).toBeVisible();

  const ceo = await signedIn(browser, "ceo@worklog.demo");
  const lead = await signedIn(browser, "lead1.it@worklog.demo");
  const reportPath = await openCurrentWeekFromReviews(lead, "Arjun Mehta");
  await expect(lead.getByText(details)).toBeVisible();

  // Not visible to the CEO until the Manager approves.
  expect((await ceo.goto(reportPath))?.status()).toBe(404);

  await lead.getByRole("button", { name: "Done" }).click();
  await lead.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(lead.getByText("Lead approved").first()).toBeVisible();

  const manager = await signedIn(browser, "manager.it@worklog.demo");
  await manager.goto(reportPath);
  await manager.getByRole("button", { name: "Request changes" }).click();
  await manager.getByLabel("What needs to change?").fill("Please split the checklist work by day.");
  await manager.getByRole("button", { name: "Send back" }).click();
  await expect(manager.getByText("Sent back to Arjun Mehta.")).toBeVisible();
  await manager.waitForURL("**/reviews");
  // Sent back, it is the developer's draft again: hidden from the Manager as well as the CEO.
  expect((await manager.goto(reportPath))?.status()).toBe(404);
  expect((await ceo.goto(reportPath))?.status()).toBe(404);

  // The developer's tasks are unlocked and the comment is shown.
  await dev.goto("/tasks");
  await expect(dev.getByText("Please split the checklist work by day.")).toBeVisible();
  await expect(dev.getByRole("button", { name: "Edit task" }).first()).toBeVisible();
});

test("the command palette finds projects and N is ignored while typing", async ({ browser }) => {
  const manager = await signedIn(browser, "manager.it@worklog.demo");
  await manager.keyboard.press("Control+k");
  await manager.getByRole("combobox", { name: /Search projects/ }).fill("portal");
  await expect(manager.getByRole("option", { name: /Client Portal/ })).toBeVisible();
  await manager.keyboard.press("Enter");
  await manager.waitForURL(/\/projects\/[a-f\d]{24}$/);

  await manager.goto("/projects");
  await manager.getByLabel("Search by name or code").fill("n");
  await expect(manager.getByRole("dialog")).toHaveCount(0);
});
