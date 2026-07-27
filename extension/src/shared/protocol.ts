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

export interface CaptureLease {
  operationId: string;
  tabId: number;
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
  windowId: number;
  tabUrl: string;
  documentId: string;
  fieldManifestKey: string;
  changedFields: number;
  completedAt: string;
  adapter: "page-agent" | "exact-fallback";
  status: "filled" | "submitted";
  warning?: string;
}

export interface ExecutionLease {
  executionId: string;
  tabId: number;
  windowId: number;
  tabUrl: string;
  documentId: string;
  agentStarted: boolean;
}

export interface AnalysisTarget {
  tabId: number;
  windowId: number;
  tabUrl: string;
  documentId: string;
  fieldManifestKey: string;
}

export interface FallbackOffer {
  tabId: number;
  windowId: number;
  tabUrl: string;
  documentId: string;
  fieldManifestKey: string;
  strategy: Strategy;
  reason: string;
}

export interface ConnectorSession {
  captures: CaptureItem[];
  captureLease: CaptureLease | null;
  preset: Preset;
  taskHint: string;
  strategies: Strategy[];
  selectedStrategyId: Strategy["id"] | null;
  executionMode: ExecutionMode;
  status: ConnectorStatus;
  error: string | null;
  lastExecution: ExecutionSummary | null;
  fallbackOffer: FallbackOffer | null;
  analysisTarget: AnalysisTarget | null;
  executionLease: ExecutionLease | null;
  executionCountdown: number | null;
}

export interface ProviderStatus {
  configured: boolean;
  openAI: "missing" | "untested" | "valid" | "invalid";
  exa: "missing" | "untested" | "valid" | "invalid";
}

export type ConnectorMessage =
  | { type: "GET_SESSION" }
  | { type: "GET_PROVIDER_STATUS" }
  | {
      type: "SAVE_AND_TEST_PROVIDER_SETTINGS";
      openAIApiKey: string;
      exaApiKey?: string;
    }
  | { type: "RETEST_PROVIDER_SETTINGS" }
  | { type: "CLEAR_PROVIDER_SETTINGS" }
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
  | { type: "EXECUTE_EXACT_FALLBACK" }
  | { type: "CANCEL_EXECUTION" }
  | { type: "UNDO" }
  | { type: "RUN_UNDO"; documentId: string }
  | { type: "HIDE_PET" }
  | { type: "SHOW_PET" }
  | { type: "CANCEL_SNIP" }
  | { type: "BEGIN_FROZEN_SNIP"; dataUrl: string }
  | { type: "DISCOVER_FIELDS" }
  | {
      type: "RUN_PAGE_AGENT";
      strategy: Strategy;
      mode: ExecutionMode;
      executionId: string;
      documentId: string;
    }
  | {
      type: "RUN_EXACT_FALLBACK";
      strategy: Strategy;
      executionId: string;
      documentId: string;
    }
  | { type: "FETCH_PAGE_AGENT"; body: string; executionId: string }
  | {
      type: "AUTHORIZE_SUBMIT";
      executionId: string;
      documentId: string;
    }
  | { type: "RELEASE_EXECUTION_GUARD"; executionId: string }
  | { type: "SESSION_UPDATED"; session: ConnectorSession };

export interface PageAgentFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}
