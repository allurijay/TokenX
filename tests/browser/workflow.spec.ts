import { test, expect } from "@playwright/test";
import "dotenv/config";
test("POS checkout, kitchen board and financial screens render", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@tokenex.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "A good day starts in sync." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  await page
    .getByRole("button", { name: "Point of sale", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Masala dosa", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Idli plate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Vegetable fried rice", exact: true })
    .click();
  await page.getByLabel("Customer name").fill("Browser Test");
  await page.getByRole("button", { name: "Review & continue" }).click();
  await expect(
    page.getByRole("button", { name: "Pay in sandbox" }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/pos.png", fullPage: true });
  await page.getByRole("button", { name: "Pay in sandbox" }).click();
  await expect(
    page.getByRole("dialog", { name: "Your order is in!" }),
  ).toBeVisible();
  await expect(
    page.getByText("PAYMENT CONFIRMED", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/receipt.png", fullPage: true });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /KitchQ kitchen/ }).click();
  await expect(
    page.getByRole("heading", { name: "KitchQ kitchen" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/kitchen.png", fullPage: true });
  await page
    .getByRole("button", { name: "Sales & finance", exact: true })
    .click();
  await expect(
    page.getByText("Net sales", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/finance.png", fullPage: true });
});
test("mobile login and menu remain within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("kiosk@tokenex.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Self-service kiosk" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
