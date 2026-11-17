import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.A11Y_URL ?? "http://127.0.0.1:5175";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error(
    "Only an isolated localhost application may be scanned by this script.",
  );
const account = JSON.parse(await readFile("work/demo-account.json", "utf8"));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const results: {
  name: string;
  violations: {
    id: string;
    impact: string | null | undefined;
    description: string;
    nodes: { target: unknown; failureSummary?: string }[];
  }[];
  incomplete: { id: string; nodes: number }[];
}[] = [];
try {
  await page.goto(base + "/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  async function scan(name: string) {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    results.push({
      name,
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      })),
      incomplete: result.incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes.length,
      })),
    });
  }
  await scan("login");
  await page
    .getByRole("link", { name: "Create an account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create your account", exact: true }),
  ).toBeVisible();
  await scan("register");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make today count.", exact: true }),
  ).toBeVisible();
  const views = [
    ["today", "/"],
    ["habits", "/habits"],
    ["analytics", "/analytics"],
    ["rewards", "/rewards"],
    ["profile", "/profile"],
    ["habit_form", "/habits/new"],
    ["reward_form", "/rewards/new"],
  ] as const;
  async function waitForData(name: string) {
    if (name === "today")
      await expect(
        page.getByRole("button", { name: "Undo Read ten pages", exact: true }),
      ).toBeVisible();
    if (name === "habits")
      await expect(
        page.getByRole("heading", { name: "Read ten pages", exact: true }),
      ).toBeVisible();
    if (name === "profile")
      await expect(
        page.getByRole("heading", { name: "Century Club", exact: true }),
      ).toBeVisible();
    if (name === "analytics")
      await expect(
        page.getByRole("heading", {
          name: "Your activity calendar",
          exact: true,
        }),
      ).toBeVisible();
    if (name === "rewards")
      await expect(
        page.getByRole("heading", { name: "Your redemptions", exact: true }),
      ).toBeVisible();
  }
  for (const [name, path] of views) {
    await page.goto(base + path);
    await expect(page.locator("main h1")).toBeVisible();
    if (name === "analytics")
      await expect(
        page.getByRole("heading", {
          name: "Your activity calendar",
          exact: true,
        }),
      ).toBeVisible();
    if (name === "rewards")
      await expect(
        page.getByRole("heading", { name: "Your redemptions", exact: true }),
      ).toBeVisible();
    await waitForData(name);
    await scan(name);
    if (name === "rewards") {
      await page
        .getByRole("button", { name: "Redeem reward", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan("purchase_dialog");
      const confirm = page.getByRole("button", {
        name: "Confirm redemption",
        exact: true,
      });
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Close", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(
        page.getByRole("button", { name: "Close", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of views.slice(0, 5)) {
    await page.goto(base + path);
    await expect(page.locator("main h1")).toBeVisible();
    await waitForData(name);
    await scan(name + "_mobile");
  }
  await page.goto(base + "/profile");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/accessibility.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        engine: "axe-core / Playwright Chromium",
        scope:
          "WCAG 2.2 AA automated rules; reduced-motion setting; synthetic isolated demo account",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      results.map((r) => ({
        name: r.name,
        violations: r.violations.length,
        incomplete: r.incomplete,
      })),
      null,
      2,
    ),
  );
  if (results.some((r) => r.violations.length)) process.exitCode = 1;
} finally {
  await browser.close();
}
