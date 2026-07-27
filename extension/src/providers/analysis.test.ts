import { describe, expect, it, vi } from "vitest";

import type { ProviderSettings } from "../shared/provider-settings";
import {
  runProviderAnalysis,
  type ProviderAnalysisInput,
} from "./analysis";

const signal = new AbortController().signal;

const input: ProviderAnalysisInput = {
  preset: "lead",
  taskHint: "Use only supported facts.",
  screenshots: [
    {
      id: "capture-profile",
      dataUrl: "data:image/jpeg;base64,cHJvZmlsZQ==",
      sourceUrl: "https://profile.example.test",
      sourceTitle: "Profile",
      capturedAt: "2026-07-27T04:00:00.000Z",
      kind: "viewport",
    },
  ],
  fields: [
    {
      key: "contactName",
      label: "Contact name",
      type: "text",
      required: true,
    },
    {
      key: "summary",
      label: "Why is this lead worth pursuing?",
      type: "textarea",
      required: true,
    },
  ],
};

const settings: ProviderSettings = {
  version: 1,
  openAIApiKey: "sk-openai-secret",
  openAIValidation: {
    status: "valid",
    checkedAt: "2026-07-27T04:00:00.000Z",
  },
};

function modelAnalysis(researchQuery: string | null, sourced = false) {
  return {
    pageSummary: "A lead form.",
    gaps: ["Public company context"],
    researchQuery,
    strategies: [
      {
        id: "safe",
        label: "Safe & precise",
        eyebrow: "Verified",
        rationale: "Leave identity unknown.",
        confidence: 0.9,
        accent: "sage",
        fields: [
          {
            key: "contactName",
            value: "",
            status: "needs-input",
            confidence: 0,
            sourceIds: [],
          },
          {
            key: "summary",
            value: sourced ? "Company launched Product X." : "Draft outreach.",
            status: sourced ? "researched" : "draft",
            confidence: 0.8,
            sourceIds: sourced ? ["exa-1"] : [],
          },
        ],
      },
      {
        id: "balanced",
        label: "Balanced",
        eyebrow: "Best overall",
        rationale: "Use grounded context.",
        confidence: 0.85,
        accent: "violet",
        fields: [
          {
            key: "contactName",
            value: "",
            status: "needs-input",
            confidence: 0,
            sourceIds: [],
          },
          {
            key: "summary",
            value: "Grounded draft.",
            status: "draft",
            confidence: 0.7,
            sourceIds: [],
          },
        ],
      },
      {
        id: "standout",
        label: "Standout",
        eyebrow: "Memorable",
        rationale: "Use a stronger voice.",
        confidence: 0.75,
        accent: "coral",
        fields: [
          {
            key: "contactName",
            value: "",
            status: "needs-input",
            confidence: 0,
            sourceIds: [],
          },
          {
            key: "summary",
            value: "Memorable draft.",
            status: "draft",
            confidence: 0.6,
            sourceIds: [],
          },
        ],
      },
    ],
  };
}

function responseFor(value: unknown) {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: JSON.stringify(value) },
        ],
      },
    ],
  });
}

describe("provider analysis orchestration", () => {
  it("runs OpenAI once when Exa is not configured", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseFor(modelAnalysis(null)));

    const result = await runProviderAnalysis(
      input,
      settings,
      fetcher,
      signal,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.notice).toContain("OpenAI vision");
    expect(result.strategies.map(({ id }) => id)).toEqual([
      "safe",
      "balanced",
      "standout",
    ]);
    expect(result.strategies[0].fields.contactName).toEqual({
      value: "",
      status: "needs-input",
      confidence: 0,
      sourceIds: [],
    });
  });

  it("runs OpenAI, optional Exa, then OpenAI refinement", async () => {
    const withExa: ProviderSettings = {
      ...settings,
      exaApiKey: "exa-secret-key",
      exaValidation: {
        status: "valid",
        checkedAt: "2026-07-27T04:00:00.000Z",
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responseFor(modelAnalysis("company Product X")))
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              title: "Product X",
              url: "https://company.example/product-x",
              highlights: ["The company launched Product X."],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(responseFor(modelAnalysis(null, true)));

    const result = await runProviderAnalysis(
      input,
      withExa,
      fetcher,
      signal,
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.notice).toContain("public research");
    expect(result.strategies[0].sources).toEqual([
      {
        id: "exa-1",
        title: "Product X",
        url: "https://company.example/product-x",
        snippet: "The company launched Product X.",
      },
    ]);
  });

  it("falls back to the initial analysis when optional Exa fails", async () => {
    const withExa: ProviderSettings = {
      ...settings,
      exaApiKey: "exa-secret-key",
      exaValidation: {
        status: "valid",
        checkedAt: "2026-07-27T04:00:00.000Z",
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responseFor(modelAnalysis("company Product X")))
      .mockResolvedValueOnce(new Response("offline", { status: 503 }));

    const result = await runProviderAnalysis(
      input,
      withExa,
      fetcher,
      signal,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.notice).toContain("research was unavailable");
    expect(result.strategies[0].sources).toEqual([]);
  });
});
