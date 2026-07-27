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
const openAIKey = "sk-openai-e2e-local-project-key";
const exaKey = "exa-e2e-local-project-key";

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

function modelAnalysis(researchQuery: string | null, sourced: boolean) {
  return {
    pageSummary: "A one-field test form.",
    gaps: researchQuery ? ["Public profile context"] : [],
    researchQuery,
    strategies: strategies.map((strategy) => ({
      id: strategy.id,
      label: strategy.label,
      eyebrow: strategy.eyebrow,
      rationale: strategy.rationale,
      confidence: strategy.confidence,
      accent: strategy.accent,
      fields: [
        {
          key: "name",
          value: "Jamie Chen",
          status: sourced ? "researched" : "supported",
          confidence: 1,
          sourceIds: sourced ? ["exa-1"] : [],
        },
      ],
    })),
  };
}

function responsesPayload(value: unknown) {
  return {
    id: "resp_connector",
    object: "response",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(value),
          },
        ],
      },
    ],
  };
}

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
  test.setTimeout(180_000);

  let responseCalls = 0;
  let exaCalls = 0;
  let pageAgentCalls = 0;
  let vercelProviderCalls = 0;
  let observedInputTool = false;
  const observedProviderUrls: string[] = [];
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1280, height: 840 },
  });

  try {
    await context.route(
      "https://mochi-overlay.vercel.app/api/**",
      async (route) => {
        vercelProviderCalls += 1;
        await route.fulfill({
          status: 418,
          contentType: "application/json",
          body: JSON.stringify({ error: "Extension must not call Vercel." }),
        });
      },
    );
    await context.route(
      "https://api.openai.com/v1/models/gpt-5.6-sol",
      async (route) => {
        observedProviderUrls.push(route.request().url());
        expect(route.request().headers().authorization).toBe(
          `Bearer ${openAIKey}`,
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "gpt-5.6-sol" }),
        });
      },
    );
    await context.route(
      "https://api.exa.ai/search",
      async (route) => {
        exaCalls += 1;
        observedProviderUrls.push(route.request().url());
        expect(route.request().headers()["x-api-key"]).toBe(exaKey);
        const body = route.request().postDataJSON() as {
          query?: string;
          numResults?: number;
        };
        expect(body.numResults).toBe(exaCalls === 1 ? 1 : 3);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            results: [
              {
                title: "Jamie Chen profile",
                url: "https://profile.example.test/jamie",
                highlights: ["Jamie Chen is a product designer."],
              },
            ],
          }),
        });
      },
    );
    await context.route(
      "https://api.openai.com/v1/responses",
      async (route) => {
        responseCalls += 1;
        observedProviderUrls.push(route.request().url());
        expect(route.request().headers().authorization).toBe(
          `Bearer ${openAIKey}`,
        );
        expect(route.request().postData()).not.toContain(openAIKey);
        expect(route.request().postData()).not.toContain(exaKey);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            responsesPayload(
              modelAnalysis(
                responseCalls === 1 ? "Jamie Chen product designer" : null,
                responseCalls > 1,
              ),
            ),
          ),
        });
      },
    );
    await context.route(
      "https://api.openai.com/v1/chat/completions",
      async (route) => {
        pageAgentCalls += 1;
        observedProviderUrls.push(route.request().url());
        expect(route.request().headers().authorization).toBe(
          `Bearer ${openAIKey}`,
        );
        const body = route.request().postDataJSON() as {
          messages: Array<{ role?: string; content?: string | null }>;
          tools: Array<{ function?: { name?: string } }>;
          tool_choice?: {
            type?: string;
            function?: { name?: string };
          };
        };
        expect(JSON.stringify(body)).not.toContain(openAIKey);
        expect(JSON.stringify(body)).not.toContain(exaKey);
        expect(body.messages.map(({ role }) => role)).toEqual([
          "system",
          "user",
        ]);
        expect(body.tools).toHaveLength(1);
        expect(body.tools[0]?.function?.name).toBe("AgentOutput");
        expect(body.tool_choice).toEqual({
          type: "function",
          function: { name: "AgentOutput" },
        });
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
    expect(extensionId).toBe("fljecmlbnknpeehjcffenmjjnenmkjea");
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(
      panel.getByRole("heading", { name: "Add your own key." }),
    ).toBeVisible();
    await panel.getByLabel("OpenAI API key").fill(openAIKey);
    await panel.getByLabel("Exa API key (optional)").fill(exaKey);
    await panel.getByRole("button", { name: "Save & test" }).click();
    await expect(
      panel.getByRole("button", { name: "Capture page" }),
    ).toBeVisible();

    const savedProviderStatus = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "mochi-provider-settings",
      );
      const settings = stored["mochi-provider-settings"] as {
        openAIValidation?: { status?: string };
        exaValidation?: { status?: string };
      };
      return {
        openAI: settings?.openAIValidation?.status,
        exa: settings?.exaValidation?.status,
      };
    });
    expect(savedProviderStatus).toEqual({
      openAI: "valid",
      exa: "valid",
    });

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

    let snipFailure: unknown;
    const snip = send(panel, { type: "START_SNIP" }).catch((error) => {
      snipFailure = error;
      return null;
    });
    await formPage.waitForFunction(
      () => Boolean(document.querySelector("[data-mochi-snip-overlay]")),
    );
    const frozen = formPage.locator("[data-mochi-snip-overlay]");
    await expect(frozen).toBeVisible();
    await formPage.mouse.move(100, 120);
    await formPage.mouse.down();
    await formPage.mouse.move(560, 420, { steps: 8 });
    await formPage.mouse.up();
    await snip;
    if (snipFailure) throw snipFailure;

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

    await expect(formPage).toHaveURL(/form-a\.html$/);
    await expect(formPage.locator("[name=name]")).toHaveValue("Jamie Chen");
    expect(responseCalls).toBe(2);
    expect(exaCalls).toBe(2);
    expect(pageAgentCalls).toBeGreaterThanOrEqual(2);
    expect(observedInputTool).toBe(true);
    expect(vercelProviderCalls).toBe(0);
    expect(observedProviderUrls.length).toBeGreaterThanOrEqual(6);
    expect(
      observedProviderUrls.every((url) =>
        url.startsWith("https://api.openai.com/") ||
        url.startsWith("https://api.exa.ai/"),
      ),
    ).toBe(true);
    await expect(
      panel.getByRole("button", { name: "Undo last fill" }),
    ).toBeVisible();

    await send(panel, { type: "UNDO" });
    await expect(formPage.locator("[name=name]")).toHaveValue("");

    await panel.getByRole("button", { name: "Provider settings" }).click();
    await panel.getByRole("button", { name: "Clear keys" }).click();
    await expect(
      panel.getByRole("heading", { name: "Add your own key." }),
    ).toBeVisible();
    expect((await readSession(worker)).captures).toHaveLength(3);
    const clearedSettings = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "mochi-provider-settings",
      );
      return stored["mochi-provider-settings"];
    });
    expect(clearedSettings).toBeUndefined();
  } finally {
    await context.close();
  }
});
