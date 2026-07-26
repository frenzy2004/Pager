import { z } from "zod";

export const pageFieldSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "email", "tel", "url", "textarea", "select"]),
  required: z.boolean(),
  options: z.array(z.string().min(1).max(120)).max(30).optional(),
});

const screenshotDataUrlSchema = z.string().regex(
  /^data:image\/(?:png|jpeg|webp);base64,/,
  "Screenshot must be a PNG, JPEG, or WebP data URL.",
);

const connectorCaptureSchema = z
  .object({
    dataUrl: screenshotDataUrlSchema.max(850_000),
    sourceUrl: z.string().url().max(2_048),
    sourceTitle: z.string().max(300),
    capturedAt: z.string().datetime(),
    kind: z.enum(["viewport", "region"]),
  })
  .transform((capture) => ({
    name: capture.sourceTitle || new URL(capture.sourceUrl).hostname,
    ...capture,
  }));

const hostedScreenshotSchema = z.object({
  name: z.string().min(1).max(180),
  dataUrl: screenshotDataUrlSchema.max(8_500_000),
});

export const analysisInputSchema = z.object({
  preset: z.enum(["job", "lead", "general"]),
  taskHint: z.string().max(800),
  screenshots: z
    .array(z.union([connectorCaptureSchema, hostedScreenshotSchema]))
    .max(8),
  fields: z.array(pageFieldSchema).min(1).max(30),
});

const fieldSuggestionSchema = z.object({
  key: z.string(),
  value: z.string(),
  status: z.enum(["supported", "researched", "draft", "needs-input"]),
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string()),
});

const modelStrategySchema = z.object({
  id: z.enum(["safe", "balanced", "standout"]),
  label: z.enum(["Safe & precise", "Balanced", "Standout"]),
  eyebrow: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  accent: z.enum(["sage", "violet", "coral"]),
  fields: z.array(fieldSuggestionSchema),
});

export const modelAnalysisSchema = z.object({
  pageSummary: z.string(),
  gaps: z.array(z.string()),
  researchQuery: z.string().nullable(),
  strategies: z.array(modelStrategySchema).length(3),
});

export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;
