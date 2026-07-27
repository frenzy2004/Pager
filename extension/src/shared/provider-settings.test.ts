import { describe, expect, it } from "vitest";

import {
  createUntestedProviderSettings,
  markProviderValidation,
  parseProviderSettings,
  providerStatus,
} from "./provider-settings";

describe("provider settings", () => {
  it("normalizes one required OpenAI key without inventing optional Exa", () => {
    const settings = createUntestedProviderSettings({
      openAIApiKey: "  sk-openai-test  ",
      exaApiKey: "   ",
    });

    expect(settings).toEqual({
      version: 1,
      openAIApiKey: "sk-openai-test",
      openAIValidation: { status: "untested" },
    });
    expect(providerStatus(settings)).toEqual({
      configured: false,
      openAI: "untested",
      exa: "missing",
    });
  });

  it("requires bounded printable key values", () => {
    expect(() =>
      createUntestedProviderSettings({ openAIApiKey: "short" }),
    ).toThrow("Enter a valid OpenAI API key.");
    expect(() =>
      createUntestedProviderSettings({
        openAIApiKey: `sk-valid\n${"x".repeat(8)}`,
      }),
    ).toThrow("Enter a valid OpenAI API key.");
    expect(() =>
      createUntestedProviderSettings({
        openAIApiKey: "x".repeat(513),
      }),
    ).toThrow("Enter a valid OpenAI API key.");
  });

  it("persists validation state without exposing key fragments in status", () => {
    const initial = createUntestedProviderSettings({
      openAIApiKey: "sk-openai-secret",
      exaApiKey: "exa-secret-key",
    });
    const openAIValid = markProviderValidation(
      initial,
      "openAI",
      "valid",
      "2026-07-27T04:00:00.000Z",
    );
    const validated = markProviderValidation(
      openAIValid,
      "exa",
      "invalid",
      "2026-07-27T04:00:01.000Z",
    );

    expect(providerStatus(validated)).toEqual({
      configured: true,
      openAI: "valid",
      exa: "invalid",
    });
    expect(JSON.stringify(providerStatus(validated))).not.toContain("secret");
  });

  it("rejects malformed persisted data instead of trusting local storage", () => {
    expect(
      parseProviderSettings({
        version: 1,
        openAIApiKey: "sk-openai-secret",
        openAIValidation: { status: "valid", checkedAt: "not-a-date" },
      }),
    ).toBeNull();
    expect(
      parseProviderSettings({
        version: 2,
        openAIApiKey: "sk-openai-secret",
        openAIValidation: { status: "valid" },
      }),
    ).toBeNull();
    expect(parseProviderSettings(null)).toBeNull();
  });
});
