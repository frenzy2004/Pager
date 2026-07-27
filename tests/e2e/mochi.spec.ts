import { expect, test } from "@playwright/test";

const mockAnalysis = {
  engine: "demo",
  notice: "Interactive browser test",
  pageSummary: "A product design application with four visible fields.",
  gaps: ["Email still needs your input."],
  strategies: [
    {
      id: "safe",
      label: "Safe & precise",
      eyebrow: "Verified facts first",
      rationale: "Conservative and supported.",
      confidence: 0.86,
      accent: "sage",
      fields: {
        fullName: {
          value: "Jamie Chen",
          status: "supported",
          confidence: 0.98,
        },
        email: { value: "", status: "needs-input", confidence: 0 },
        targetRole: {
          value: "Product Designer",
          status: "supported",
          confidence: 0.96,
        },
        summary: {
          value: "A precise product design summary.",
          status: "draft",
          confidence: 0.8,
        },
      },
      sources: [],
    },
    {
      id: "balanced",
      label: "Balanced",
      eyebrow: "Best all-rounder",
      rationale: "Clear, confident, and grounded.",
      confidence: 0.92,
      accent: "violet",
      fields: {
        fullName: {
          value: "Jamie Chen",
          status: "supported",
          confidence: 0.98,
        },
        email: { value: "", status: "needs-input", confidence: 0 },
        targetRole: {
          value: "Product Designer",
          status: "supported",
          confidence: 0.96,
        },
        summary: {
          value:
            "I connect systems thinking, close collaboration, and measurable product outcomes.",
          status: "draft",
          confidence: 0.86,
        },
      },
      sources: [],
    },
    {
      id: "standout",
      label: "Standout",
      eyebrow: "Memorable framing",
      rationale: "Distinctive without overclaiming.",
      confidence: 0.84,
      accent: "coral",
      fields: {
        fullName: {
          value: "Jamie Chen",
          status: "supported",
          confidence: 0.98,
        },
        email: { value: "", status: "needs-input", confidence: 0 },
        targetRole: {
          value: "Product Designer",
          status: "supported",
          confidence: 0.96,
        },
        summary: {
          value:
            "I turn product complexity into workflows people understand and outcomes teams can measure.",
          status: "draft",
          confidence: 0.82,
        },
      },
      sources: [],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/connector/session", async (route) => {
    expect(route.request().headers()["x-mochi-client-id"]).toBe(
      "abcdefghijklmnopabcdefghijklmnop",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "e2e-web-session-token",
        expiresAt: Date.now() + 15 * 60_000,
      }),
    });
  });
  await page.route("**/api/analyze", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer e2e-web-session-token",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockAnalysis),
    });
  });
});

test("screenshot context fills supported values and undo restores the page", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /show it.*mochi gets it.*let it act/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Mochi" }).click();
  await expect(
    page.getByRole("dialog", { name: "Mochi context assistant" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /use sample context/i }).click();
  await page.getByRole("button", { name: "Analyze context" }).click();

  await expect(page.getByTestId("strategy-card")).toHaveCount(3);
  await page.getByRole("radio", { name: /fill only/i }).check();
  await page.getByRole("button", { name: "Fill this page" }).click();

  await expect(page.getByLabel("Full name")).toHaveValue("Jamie Chen");
  await expect(page.getByLabel("Email address")).toHaveValue("");
  await expect(page.getByLabel("Role you are applying for")).toHaveValue(
    "Product Designer",
  );
  await expect(page.getByLabel("Why are you a strong fit?")).toHaveValue(
    /systems thinking/,
  );

  await page.getByRole("button", { name: "Undo page changes" }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("");
  await expect(page.getByLabel("Role you are applying for")).toHaveValue("");
  await expect(page.getByLabel("Why are you a strong fit?")).toHaveValue("");
});

test("review mode does not mutate until approval", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Mochi" }).click();
  await page.getByRole("button", { name: /use sample context/i }).click();
  await page.getByRole("button", { name: "Analyze context" }).click();
  await page.getByRole("button", { name: "Review changes" }).click();

  await expect(page.getByText(/ready for your approval/i)).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("");

  await page.getByRole("button", { name: "Approve and fill" }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("Jamie Chen");
});

test("mobile turns the pet into a bounded bottom sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("/");
  await page.getByRole("button", { name: "Open Mochi" }).click();

  const dialog = page.getByRole("dialog", { name: "Mochi context assistant" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const animatedBox = await dialog.boundingBox();
      return animatedBox
        ? animatedBox.y + animatedBox.height
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(page.viewportSize()!.height);
  const box = await dialog.boundingBox();

  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThan(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
});
