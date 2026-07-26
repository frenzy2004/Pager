import type {
  AnalysisInput,
  AnalysisResult,
  Preset,
  Strategy,
} from "@/lib/mochi/types";

const IDENTITY_FIELD_PATTERN =
  /(name|email|phone|mobile|address|passport|identity|legal|birthday|birth|ssn|tax)/i;

const missionCopy: Record<
  Preset,
  { safe: string; balanced: string; standout: string; pageSummary: string }
> = {
  job: {
    safe: "Product-minded contributor with relevant experience and a clear match to the role requirements shown in the supplied context.",
    balanced:
      "I connect product thinking, thoughtful execution, and close collaboration to turn ambiguous problems into useful outcomes.",
    standout:
      "I bring product judgment and maker energy: I clarify the real problem, rally the right people, and ship work users can feel.",
    pageSummary:
      "A job application asking for identity details and a concise statement of fit.",
  },
  lead: {
    safe: "A relevant team may benefit from a concise conversation about the problem and evidence provided in the screenshots.",
    balanced:
      "This team appears aligned with the use case. Lead with the observed problem, connect it to a concrete outcome, and invite a short discovery call.",
    standout:
      "Open with the sharpest signal in the context, offer one useful insight immediately, and earn the next conversation without a generic pitch.",
    pageSummary:
      "A lead qualification form asking for contact context, fit, and a useful outreach angle.",
  },
  general: {
    safe: "This request is based only on the supplied context and avoids unsupported personal details.",
    balanced:
      "This request summarizes the supplied context clearly, answers the visible criteria, and flags anything that still needs confirmation.",
    standout:
      "This request leads with the strongest relevant outcome, keeps the language crisp, and turns uncertainty into an explicit next step.",
    pageSummary:
      "A general-purpose form that needs grounded context and a concise explanation.",
  },
};

const strategyMeta = [
  {
    id: "safe",
    label: "Safe & precise",
    eyebrow: "Verified facts first",
    rationale: "Conservative wording with unsupported details left blank.",
    confidence: 0.86,
    accent: "sage",
  },
  {
    id: "balanced",
    label: "Balanced",
    eyebrow: "Best all-rounder",
    rationale: "Clear, confident, and grounded in the supplied context.",
    confidence: 0.92,
    accent: "violet",
  },
  {
    id: "standout",
    label: "Standout",
    eyebrow: "Memorable framing",
    rationale: "Bolder language without inventing personal facts.",
    confidence: 0.84,
    accent: "coral",
  },
] as const;

function suggestionFor(
  key: string,
  label: string,
  copy: string,
  options?: string[],
) {
  if (IDENTITY_FIELD_PATTERN.test(`${key} ${label}`)) {
    return {
      value: "",
      status: "needs-input" as const,
      confidence: 0,
    };
  }

  if (options?.length) {
    return {
      value: options[0] ?? "",
      status: "draft" as const,
      confidence: 0.65,
    };
  }

  return {
    value: copy,
    status: "draft" as const,
    confidence: 0.72,
  };
}

export function createDemoAnalysis(input: AnalysisInput): AnalysisResult {
  const copy = missionCopy[input.preset];
  const strategies = strategyMeta.map((meta) => {
    const values = input.fields.map((field) => [
      field.key,
      suggestionFor(field.key, field.label, copy[meta.id], field.options),
    ]);

    return {
      ...meta,
      fields: Object.fromEntries(values),
      sources: [],
    } satisfies Strategy;
  }) as [Strategy, Strategy, Strategy];

  const hasImages = input.screenshots.length > 0;

  return {
    engine: "demo",
    notice:
      "Interactive demo — connect server-side OpenAI and Exa keys for live screenshot understanding and research.",
    pageSummary: copy.pageSummary,
    gaps: hasImages
      ? ["Identity details still need your confirmation."]
      : [
          "Add a screenshot for visual context.",
          "Identity details still need your confirmation.",
        ],
    strategies,
  };
}

