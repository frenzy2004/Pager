export type ExecutionMode = "review" | "fill" | "autopilot";
export type Preset = "job" | "lead" | "general";
export type ConnectorStatus =
  | "idle"
  | "capturing"
  | "analyzing"
  | "ready"
  | "executing"
  | "error";

export interface CaptureItem {
  id: string;
  dataUrl: string;
  sourceUrl: string;
  sourceTitle: string;
  capturedAt: string;
  kind: "viewport" | "region";
}

export interface FieldSuggestion {
  value: string;
  status: "supported" | "researched" | "draft" | "needs-input";
  confidence: number;
  sourceIds: string[];
}

export interface Strategy {
  id: "safe" | "balanced" | "standout";
  label: "Safe & precise" | "Balanced" | "Standout";
  eyebrow: string;
  rationale: string;
  confidence: number;
  accent: "sage" | "violet" | "coral";
  fields: Record<string, FieldSuggestion>;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    snippet?: string;
  }>;
}

export interface ExecutionSummary {
  tabId: number;
  changedFields: number;
  completedAt: string;
}

export interface ConnectorSession {
  captures: CaptureItem[];
  preset: Preset;
  taskHint: string;
  strategies: Strategy[];
  selectedStrategyId: Strategy["id"] | null;
  executionMode: ExecutionMode;
  status: ConnectorStatus;
  error: string | null;
  lastExecution: ExecutionSummary | null;
}

export type ConnectorMessage =
  | { type: "GET_SESSION" }
  | { type: "OPEN_PANEL" }
  | { type: "CAPTURE_VIEWPORT" }
  | { type: "START_SNIP" }
  | { type: "REMOVE_CAPTURE"; captureId: string }
  | { type: "CLEAR_SESSION" }
  | { type: "SET_PRESET"; preset: Preset }
  | { type: "SET_TASK_HINT"; taskHint: string }
  | { type: "ANALYZE" }
  | { type: "SELECT_STRATEGY"; strategyId: Strategy["id"] }
  | { type: "SET_MODE"; mode: ExecutionMode }
  | { type: "EXECUTE" }
  | { type: "CANCEL_EXECUTION" }
  | { type: "UNDO" }
  | { type: "HIDE_PET" }
  | { type: "SHOW_PET" }
  | { type: "BEGIN_FROZEN_SNIP"; dataUrl: string }
  | { type: "DISCOVER_FIELDS" }
  | { type: "RUN_PAGE_AGENT"; strategy: Strategy; mode: ExecutionMode }
  | { type: "FETCH_PAGE_AGENT"; body: string }
  | { type: "SESSION_UPDATED"; session: ConnectorSession };

export interface PageAgentFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}
