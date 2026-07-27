import { z } from "zod";

import type {
  CaptureItem,
  PageAgentFetchResponse,
  Preset,
} from "../shared/protocol";
import type { SafePageAgentRequest } from "./page-agent-policy";

export const OPENAI_MODEL = "gpt-5.6-sol";
export const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses";
export const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODEL_URL =
  `https://api.openai.com/v1/models/${OPENAI_MODEL}`;

export interface FieldDescriptor {
  key: string;
  label: string;
  type:
    | "text"
    | "email"
    | "tel"
    | "url"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio";
  required: boolean;
  options?: string[];
}

export interface ProviderAnalysisInput {
  preset: Preset;
  taskHint: string;
  screenshots: CaptureItem[];
  fields: FieldDescriptor[];
}

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  snippet?: string;
}

export type ProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const fieldSuggestionSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(6_000),
  status: z.enum(["supported", "researched", "draft", "needs-input"]),
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string().min(1).max(120)).max(10),
});

const modelStrategySchema = z.object({
  id: z.enum(["safe", "balanced", "standout"]),
  label: z.enum(["Safe & precise", "Balanced", "Standout"]),
  eyebrow: z.string().min(1).max(120),
  rationale: z.string().min(1).max(1_200),
  confidence: z.number().min(0).max(1),
  accent: z.enum(["sage", "violet", "coral"]),
  fields: z.array(fieldSuggestionSchema).max(30),
});

export const modelAnalysisSchema = z.object({
  pageSummary: z.string().max(2_000),
  gaps: z.array(z.string().max(500)).max(30),
  researchQuery: z.string().min(1).max(300).nullable(),
  strategies: z.array(modelStrategySchema).length(3),
});

export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;

const stringSchema = { type: "string" } as const;
const fieldSuggestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "key",
    "value",
    "status",
    "confidence",
    "sourceIds",
  ],
  properties: {
    key: stringSchema,
    value: stringSchema,
    status: {
      type: "string",
      enum: ["supported", "researched", "draft", "needs-input"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    sourceIds: { type: "array", items: stringSchema },
  },
} as const;

export const MODEL_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pageSummary", "gaps", "researchQuery", "strategies"],
  properties: {
    pageSummary: stringSchema,
    gaps: { type: "array", items: stringSchema },
    researchQuery: {
      anyOf: [stringSchema, { type: "null" }],
    },
    strategies: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "eyebrow",
          "rationale",
          "confidence",
          "accent",
          "fields",
        ],
        properties: {
          id: {
            type: "string",
            enum: ["safe", "balanced", "standout"],
          },
          label: {
            type: "string",
            enum: ["Safe & precise", "Balanced", "Standout"],
          },
          eyebrow: stringSchema,
          rationale: stringSchema,
          confidence: { type: "number", minimum: 0, maximum: 1 },
          accent: {
            type: "string",
            enum: ["sage", "violet", "coral"],
          },
          fields: {
            type: "array",
            maxItems: 30,
            items: fieldSuggestionJsonSchema,
          },
        },
      },
    },
  },
} as const;

function promptFor(
  input: ProviderAnalysisInput,
  evidence: ResearchSource[],
) {
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
    "Use exact field keys from the manifest. Include every field in every strategy.",
    "Never invent identity, contact, credential, employment, financial, or other personal facts.",
    "When a personal fact is not visibly supported, use an empty value, status needs-input, confidence 0.",
    "Draft persuasive copy only from supported context; label creative phrasing as draft.",
    "Safe is conservative. Balanced is concise and confident. Standout is memorable but factual.",
    "Set researchQuery to one short public-web query only when public research materially improves a non-personal answer; otherwise null.",
    "Source IDs may only reference supplied research evidence.",
    `Mission preset: ${input.preset}.`,
    `User hint: ${input.taskHint || "No additional hint."}`,
    `Page fields: ${JSON.stringify(fields)}`,
    evidence.length
      ? `Public research evidence: ${JSON.stringify(evidence)}`
      : "Public research evidence: none.",
  ].join("\n");
}

function openAIError(status: number) {
  if (status === 401) {
    return new Error("OpenAI rejected this key. Replace it in Settings.");
  }
  if (status === 403 || status === 404) {
    return new Error("This key cannot use Mochi's model.");
  }
  if (status === 429) {
    return new Error("OpenAI rate limit or project quota reached.");
  }
  return new Error(`OpenAI request failed (${status}).`);
}

async function openAIFetch(
  input: string,
  init: RequestInit,
  fetcher: ProviderFetch,
) {
  try {
    return await fetcher(input, init);
  } catch {
    throw new Error("Mochi could not reach OpenAI.");
  }
}

export async function testOpenAIKey(
  apiKey: string,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<void> {
  const response = await openAIFetch(
    OPENAI_MODEL_URL,
    {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
    },
    fetcher,
  );
  if (!response.ok) throw openAIError(response.status);
}

function outputText(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

export async function askOpenAI(
  apiKey: string,
  input: ProviderAnalysisInput,
  evidence: ResearchSource[],
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<ModelAnalysis> {
  const response = await openAIFetch(
    OPENAI_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_output_tokens: 3_000,
        reasoning: { effort: "low" },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: promptFor(input, evidence),
              },
              ...input.screenshots.map(({ dataUrl }) => ({
                type: "input_image",
                image_url: dataUrl,
                detail: "high",
              })),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "mochi_analysis",
            strict: true,
            schema: MODEL_ANALYSIS_JSON_SCHEMA,
          },
        },
      }),
      signal,
    },
    fetcher,
  );
  if (!response.ok) throw openAIError(response.status);

  try {
    const payload = (await response.json()) as unknown;
    const text = outputText(payload);
    if (!text) throw new Error();
    return modelAnalysisSchema.parse(JSON.parse(text));
  } catch {
    throw new Error("OpenAI returned an invalid Mochi response.");
  }
}

export async function completePageAgent(
  apiKey: string,
  body: SafePageAgentRequest,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<PageAgentFetchResponse> {
  const response = await openAIFetch(
    OPENAI_CHAT_COMPLETIONS_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    },
    fetcher,
  );
  if (!response.ok) throw openAIError(response.status);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
    bodyText: await response.text(),
  };
}
