import type {
  ProviderSettings,
} from "../shared/provider-settings";
import type {
  Strategy,
} from "../shared/protocol";
import { searchExa } from "./exa";
import {
  askOpenAI,
  type ModelAnalysis,
  type ProviderAnalysisInput,
  type ProviderFetch,
  type ResearchSource,
} from "./openai";

export type { ProviderAnalysisInput } from "./openai";

const STRATEGY_ORDER = ["safe", "balanced", "standout"] as const;

function normalizeStrategies(
  model: ModelAnalysis,
  input: ProviderAnalysisInput,
  sources: ResearchSource[],
): [Strategy, Strategy, Strategy] {
  const allowedKeys = new Set(input.fields.map(({ key }) => key));
  if (
    model.strategies.some((strategy) =>
      strategy.fields.some(({ key }) => !allowedKeys.has(key)),
    )
  ) {
    throw new Error("OpenAI returned an invalid Mochi response.");
  }
  const byId = new Map(
    model.strategies.map((strategy) => [strategy.id, strategy]),
  );
  if (byId.size !== 3) {
    throw new Error("OpenAI returned an invalid Mochi response.");
  }

  return STRATEGY_ORDER.map((id) => {
    const strategy = byId.get(id);
    if (!strategy) {
      throw new Error("OpenAI returned an invalid Mochi response.");
    }
    const suggestions = new Map(
      strategy.fields.map((suggestion) => [
        suggestion.key,
        suggestion,
      ]),
    );
    const fields = Object.fromEntries(
      input.fields.map((field) => {
        const suggestion = suggestions.get(field.key);
        return [
          field.key,
          suggestion
            ? {
                value: suggestion.value,
                status: suggestion.status,
                confidence: suggestion.confidence,
                sourceIds: suggestion.sourceIds.filter((sourceId) =>
                  sources.some((source) => source.id === sourceId),
                ),
              }
            : {
                value: "",
                status: "needs-input" as const,
                confidence: 0,
                sourceIds: [],
              },
        ];
      }),
    );
    return {
      id: strategy.id,
      label: strategy.label,
      eyebrow: strategy.eyebrow,
      rationale: strategy.rationale,
      confidence: strategy.confidence,
      accent: strategy.accent,
      fields,
      sources,
    };
  }) as [Strategy, Strategy, Strategy];
}

export async function runProviderAnalysis(
  input: ProviderAnalysisInput,
  settings: ProviderSettings,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<{
  strategies: [Strategy, Strategy, Strategy];
  notice: string;
}> {
  const initial = await askOpenAI(
    settings.openAIApiKey,
    input,
    [],
    fetcher,
    signal,
  );
  let final = initial;
  let sources: ResearchSource[] = [];
  let researchUnavailable = false;

  if (
    initial.researchQuery &&
    settings.exaApiKey &&
    settings.exaValidation?.status === "valid"
  ) {
    try {
      sources = await searchExa(
        initial.researchQuery,
        settings.exaApiKey,
        fetcher,
        signal,
      );
      if (sources.length > 0) {
        final = await askOpenAI(
          settings.openAIApiKey,
          input,
          sources,
          fetcher,
          signal,
        );
      }
    } catch {
      researchUnavailable = true;
      sources = [];
    }
  }

  return {
    notice: sources.length
      ? "Live OpenAI vision + public research. Review sourced facts before acting."
      : researchUnavailable
        ? "Live OpenAI vision succeeded; public research was unavailable for this run."
        : initial.researchQuery && !settings.exaApiKey
          ? "Live OpenAI vision. Add optional Exa in Settings for public research."
          : "Live OpenAI vision. No additional public research was needed.",
    strategies: normalizeStrategies(final, input, sources),
  };
}
