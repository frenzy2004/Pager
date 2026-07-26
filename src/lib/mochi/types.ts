export type Preset = "job" | "lead" | "general";

export type ExecutionMode = "review" | "fill" | "autopilot";

export type SuggestionStatus =
  | "supported"
  | "researched"
  | "draft"
  | "needs-input";

export type StrategyAccent = "sage" | "violet" | "coral";

export interface ScreenshotInput {
  name: string;
  dataUrl: string;
}

export interface PageField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "url" | "textarea" | "select";
  required: boolean;
  options?: string[];
}

export interface AnalysisInput {
  preset: Preset;
  taskHint: string;
  screenshots: ScreenshotInput[];
  fields: PageField[];
}

export interface SuggestedField {
  value: string;
  status: SuggestionStatus;
  confidence: number;
  sourceIds?: string[];
}

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  snippet?: string;
}

export interface Strategy {
  id: "safe" | "balanced" | "standout";
  label: "Safe & precise" | "Balanced" | "Standout";
  eyebrow: string;
  rationale: string;
  confidence: number;
  accent: StrategyAccent;
  fields: Record<string, SuggestedField>;
  sources: ResearchSource[];
}

export interface AnalysisResult {
  engine: "demo" | "openai" | "openai+exa";
  notice: string;
  pageSummary: string;
  gaps: string[];
  strategies: [Strategy, Strategy, Strategy];
}

export type ExecutionStatus =
  | "preview"
  | "filled"
  | "submitted"
  | "cancelled";

export interface ExecutionResult {
  status: ExecutionStatus;
  adapter: "dom" | "page-agent";
  values: Record<string, string>;
}

export interface ActionDriver {
  execute(
    strategy: Strategy,
    mode: ExecutionMode,
  ): Promise<ExecutionResult>;
  cancel(): void;
}

