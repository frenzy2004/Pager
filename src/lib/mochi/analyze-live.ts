import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { modelAnalysisSchema, type ModelAnalysis } from "@/lib/mochi/schema";
import type {
  AnalysisInput,
  AnalysisResult,
  ResearchSource,
  Strategy,
} from "@/lib/mochi/types";

const STRATEGY_ORDER = ["safe", "balanced", "standout"] as const;

interface ExaSearchResult {
  title?: string;
  url?: string;
  highlights?: string[];
  text?: string;
}

function promptFor(input: AnalysisInput, evidence: ResearchSource[]) {
  const fields = input.fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options ?? [],
  }));

  return [
    "You are Mochi, a universal form-context analyst.",
    "Read every supplied screenshot and the current page field manifest.",
    "Return exactly three strategies in this order: safe, balanced, standout.",
    "Use the exact field keys from the manifest. Include every field in every strategy.",
    "Never invent identity, contact, credential, employment, financial, or other personal facts.",
    "When a personal fact is not visibly supported, use an empty value, status needs-input, confidence 0.",
    "Draft persuasive copy only from supported context; label creative phrasing as draft.",
    "Safe is conservative. Balanced is concise and confident. Standout is memorable but still factual.",
    "Set researchQuery to one short public-web query only when public research would materially improve a non-personal answer; otherwise null.",
    "Source IDs may only reference the supplied research evidence.",
    `Mission preset: ${input.preset}.`,
    `User hint: ${input.taskHint || "No additional hint."}`,
    `Page fields: ${JSON.stringify(fields)}`,
    evidence.length
      ? `Public research evidence: ${JSON.stringify(evidence)}`
      : "Public research evidence: none.",
  ].join("\n");
}

async function askOpenAI(
  input: AnalysisInput,
  evidence: ResearchSource[] = [],
): Promise<ModelAnalysis> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageContent = input.screenshots.map((screenshot) => ({
    type: "input_image" as const,
    image_url: screenshot.dataUrl,
    detail: "high" as const,
  }));

  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
    reasoning: { effort: "low" },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: promptFor(input, evidence) },
          ...imageContent,
        ],
      },
    ],
    text: {
      format: zodTextFormat(modelAnalysisSchema, "mochi_analysis"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI returned no structured analysis.");
  }

  return response.output_parsed;
}

async function searchExa(
  query: string,
  apiKey: string,
): Promise<ResearchSource[]> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "fast",
      numResults: 5,
      moderation: true,
      contents: {
        highlights: {
          maxCharacters: 1200,
        },
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Exa search failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { results?: ExaSearchResult[] };
  return (body.results ?? [])
    .filter(
      (result): result is ExaSearchResult & { title: string; url: string } =>
        Boolean(result.title && result.url),
    )
    .slice(0, 5)
    .map((result, index) => ({
      id: `exa-${index + 1}`,
      title: result.title,
      url: result.url,
      snippet:
        result.highlights?.filter(Boolean).join(" ").slice(0, 1200) ||
        result.text?.slice(0, 1200),
    }));
}

function normalizeStrategies(
  model: ModelAnalysis,
  input: AnalysisInput,
  sources: ResearchSource[],
): [Strategy, Strategy, Strategy] {
  const byId = new Map(model.strategies.map((strategy) => [strategy.id, strategy]));

  return STRATEGY_ORDER.map((id) => {
    const strategy = byId.get(id);
    if (!strategy) {
      throw new Error(`OpenAI omitted the ${id} strategy.`);
    }

    const suggestions = new Map(
      strategy.fields.map((suggestion) => [suggestion.key, suggestion]),
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

export async function runLiveAnalysis(
  input: AnalysisInput,
): Promise<AnalysisResult> {
  const initial = await askOpenAI(input);
  const exaKey = process.env.EXA_API_KEY;
  let sources: ResearchSource[] = [];
  let final = initial;
  let researchUnavailable = false;

  if (initial.researchQuery && exaKey) {
    try {
      sources = await searchExa(initial.researchQuery, exaKey);
      if (sources.length) {
        final = await askOpenAI(input, sources);
      }
    } catch {
      researchUnavailable = true;
    }
  }

  return {
    engine: sources.length ? "openai+exa" : "openai",
    notice: sources.length
      ? "Live vision + public research. Review sourced facts before acting."
      : researchUnavailable
        ? "Live vision succeeded; public research was unavailable for this run."
        : "Live OpenAI vision. No additional public research was needed.",
    pageSummary: final.pageSummary,
    gaps: final.gaps,
    strategies: normalizeStrategies(final, input, sources),
  };
}

