import path from "node:path";

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

import type {
  ConnectorMessage,
  ConnectorSession,
} from "../../extension/src/shared/protocol";

const extensionPath = path.join(process.cwd(), "extension", "dist");

const strategies = [
  {
    id: "safe",
    label: "Safe & precise",
    eyebrow: "Verified",
    rationale: "Use only supported facts.",
    confidence: 0.94,
    accent: "sage",
    fields: {
      name: {
        value: "Jamie Chen",
        status: "supported",
        confidence: 1,
        sourceIds: [],
      },
    },
    sources: [],
  },
  {
    id: "balanced",
    label: "Balanced",
    eyebrow: "Best overall",
    rationale: "Clear, warm, and grounded.",
    confidence: 0.9,
    accent: "violet",
    fields: {
      name: {
        value: "Jamie Chen",
        status: "supported",
        confidence: 1,
        sourceIds: [],
      },
    },
    sources: [],
  },
  {
    id: "standout",
    label: "Standout",
    eyebrow: "Memorable",
    rationale: "A stronger voice without invention.",
    confidence: 0.82,
    accent: "coral",
    fields: {
      name: {
        value: "Jamie Chen",
        status: "supported",
        confidence: 1,
        sourceIds: [],
      },
    },
    sources: [],
  },
];

async function extensionWorker(context: BrowserContext) {
  const existing = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"));
  return (
    existing ??
    (await context.waitForEvent("serviceworker", {
      predicate: (worker) => worker.url().startsWith("chrome-extension://"),
    }))
  );
}

async function send(panel: Page, message: ConnectorMessage) {
  const response = await panel.evaluate(
    async (payload) => chrome.runtime.sendMessage(payload),
    message,
  );
  expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
  return response as { ok: true; result: unknown };
}

async function readSession(worker: Worker) {
  return worker.evaluate(async () => {
    const value = await chrome.storage.session.get("mochi-session");
    return value["mochi-session"] as ConnectorSession;
  });
}

test("connector follows tabs, captures repeatedly, snips, fills with Page Agent, and undoes", async ({
  }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  test.setTimeout(120_000);

  let pageAgentCalls = 0;
  let observedInputTool = false;
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1280, height: 840 },
  });

  try {
    await context.route(
      "https://mochi-overlay.vercel.app/api/analyze",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            engine: "openai",
            notice: "Connector browser test",
            pageSummary: "A one-field test form.",
            gaps: [],
            strategies,
          }),
        });
      },
    );
    await context.route(
      "https://mochi-overlay.vercel.app/api/page-agent/chat/completions",
      async (route) => {
        pageAgentCalls += 1;
        const body = route.request().postDataJSON() as {
          messages: Array<{ content?: string | null }>;
          tools: Array<{ function?: { name?: string } }>;
        };
        observedInputTool ||=
          JSON.stringify(body.tools).includes('"input_text"');
        const browserState = body.messages
          .map(({ content }) => content ?? "")
          .join("\n");
        const firstInputIndex =
          browserState.match(/\[(\d+)\]<input\b/)?.[1] ?? "0";
        const action =
          pageAgentCalls === 1
            ? {
                input_text: {
                  index: Number(firstInputIndex),
                  text: "Jamie Chen",
                },
              }
            : {
                done: {
                  success: true,
                  text: "Filled the requested field.",
                },
              };

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: `chatcmpl-connector-${pageAgentCalls}`,
            object: "chat.completion",
            created: 1_785_068_400,
            model: "gpt-5.6-sol",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: `call-${pageAgentCalls}`,
                      type: "function",
                      function: {
                        name: "AgentOutput",
                        arguments: JSON.stringify({
                          evaluation_previous_goal:
                            pageAgentCalls === 1
                              ? "The requested field is visible."
                              : "The exact name was entered.",
                          memory: "Use only Jamie Chen.",
                          next_goal:
                            pageAgentCalls === 1
                              ? "Fill the name field."
                              : "Finish without submitting.",
                          action,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          }),
        });
      },
    );

    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const profilePage = await context.newPage();
    await profilePage.goto(
      "http://localhost:3000/connector-fixtures/context-b.html",
    );
    const formPage = await context.newPage();
    await formPage.goto(
      "http://localhost:3000/connector-fixtures/form-a.html",
    );

    await expect(
      profilePage.locator("[data-mochi-connector]"),
    ).toBeVisible();
    await expect(formPage.locator("[data-mochi-connector]")).toBeVisible();

    await profilePage.bringToFront();
    await profilePage.locator("[data-mochi-connector]").click();
    await send(panel, { type: "CAPTURE_VIEWPORT" });

    await formPage.bringToFront();
    await send(panel, { type: "CAPTURE_VIEWPORT" });

    const snip = send(panel, { type: "START_SNIP" });
    const frozen = formPage.locator("[data-mochi-snip-overlay]");
    await expect(frozen).toBeVisible();
    await formPage.mouse.move(100, 120);
    await formPage.mouse.down();
    await formPage.mouse.move(560, 420, { steps: 8 });
    await formPage.mouse.up();
    await snip;

    await expect.poll(async () => (await readSession(worker)).captures.length).toBe(3);
    await expect(panel.getByText("3 / 8", { exact: true })).toBeVisible();
    await expect(panel.getByLabel("Captured context").locator("article")).toHaveCount(3);

    await send(panel, { type: "SET_PRESET", preset: "general" });
    await send(panel, { type: "ANALYZE" });
    await expect
      .poll(async () => (await readSession(worker)).strategies.length)
      .toBe(3);
    await expect(panel.getByTestId("connector-strategy")).toHaveCount(3);
    await expect(panel.getByText("Choose your move.")).toBeVisible();
    await send(panel, { type: "SET_MODE", mode: "fill" });
    await send(panel, { type: "EXECUTE" });

    await expect(formPage.locator("[name=name]")).toHaveValue("Jamie Chen");
    expect(pageAgentCalls).toBeGreaterThanOrEqual(2);
    expect(observedInputTool).toBe(true);
    await expect(
      panel.getByRole("button", { name: "Undo last fill" }),
    ).toBeVisible();

    await send(panel, { type: "UNDO" });
    await expect(formPage.locator("[name=name]")).toHaveValue("");
  } finally {
    await context.close();
  }
});
