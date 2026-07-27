import type {
  AnalysisTarget,
  CaptureItem,
  ConnectorMessage,
  ConnectorSession,
  ExecutionMode,
  ExecutionLease,
  ExecutionSummary,
  FallbackOffer,
  Preset,
  Strategy,
} from "./protocol";
import { MAX_SCREENSHOT_DATA_URL_LENGTH } from "../../../src/lib/mochi/image-limits";
import { isProviderKeyCandidate } from "./provider-settings";

export const MAX_CAPTURES = 8;
export const MAX_CAPTURE_DATA_URL_LENGTH =
  MAX_SCREENSHOT_DATA_URL_LENGTH;

export type SessionAction =
  | { type: "capture-added"; capture: CaptureItem }
  | { type: "capture-removed"; captureId: string }
  | { type: "preset-changed"; preset: Preset }
  | { type: "task-hint-changed"; taskHint: string }
  | { type: "analysis-started" }
  | {
      type: "analysis-succeeded";
      strategies: Strategy[];
      target: AnalysisTarget;
    }
  | { type: "strategy-selected"; strategyId: Strategy["id"] }
  | { type: "mode-changed"; mode: ExecutionMode }
  | { type: "execution-started"; lease: ExecutionLease }
  | { type: "execution-succeeded"; summary: ExecutionSummary }
  | { type: "fallback-offered"; offer: FallbackOffer }
  | { type: "failed"; error: string }
  | { type: "cleared" };

export function createEmptySession(): ConnectorSession {
  return {
    captures: [],
    captureLease: null,
    preset: "general",
    taskHint: "",
    strategies: [],
    selectedStrategyId: null,
    executionMode: "review",
    status: "idle",
    error: null,
    lastExecution: null,
    fallbackOffer: null,
    analysisTarget: null,
    executionLease: null,
    executionCountdown: null,
  };
}

export function reduceSession(
  state: ConnectorSession,
  action: SessionAction,
): ConnectorSession {
  switch (action.type) {
    case "capture-added":
      return {
        ...state,
        captures:
          state.captures.length >= MAX_CAPTURES
            ? state.captures
            : [...state.captures, action.capture],
        captureLease: null,
        error: null,
        fallbackOffer: null,
        analysisTarget: null,
        strategies: [],
        selectedStrategyId: null,
        status: "idle",
      };
    case "capture-removed":
      return {
        ...state,
        captures: state.captures.filter(
          ({ id }) => id !== action.captureId,
        ),
        fallbackOffer: null,
        analysisTarget: null,
        strategies: [],
        selectedStrategyId: null,
        status: "idle",
      };
    case "preset-changed":
      return {
        ...state,
        preset: action.preset,
        strategies: [],
        selectedStrategyId: null,
        fallbackOffer: null,
        analysisTarget: null,
        status: "idle",
      };
    case "task-hint-changed":
      return {
        ...state,
        taskHint: action.taskHint.slice(0, 800),
        strategies: [],
        selectedStrategyId: null,
        fallbackOffer: null,
        analysisTarget: null,
        status: "idle",
      };
    case "analysis-started":
      return {
        ...state,
        error: null,
        fallbackOffer: null,
        strategies: [],
        selectedStrategyId: null,
        analysisTarget: null,
        status: "analyzing",
      };
    case "analysis-succeeded":
      return {
        ...state,
        strategies: action.strategies.slice(0, 3),
        selectedStrategyId:
          action.strategies.find(({ id }) => id === "balanced")?.id ??
          action.strategies[0]?.id ??
          null,
        error: null,
        fallbackOffer: null,
        analysisTarget: action.target,
        status: "ready",
      };
    case "strategy-selected":
      return state.strategies.some(({ id }) => id === action.strategyId)
        ? {
            ...state,
            selectedStrategyId: action.strategyId,
            fallbackOffer: null,
          }
        : state;
    case "mode-changed":
      return {
        ...state,
        executionMode: action.mode,
        fallbackOffer: null,
      };
    case "execution-started":
      return {
        ...state,
        error: null,
        fallbackOffer: null,
        executionLease: action.lease,
        executionCountdown: null,
        status: "executing",
      };
    case "execution-succeeded":
      return {
        ...state,
        lastExecution: action.summary,
        fallbackOffer: null,
        executionLease: null,
        error: null,
        executionCountdown: null,
        status: "ready",
      };
    case "fallback-offered":
      return {
        ...state,
        fallbackOffer: action.offer,
        executionLease: null,
        executionCountdown: null,
        status: "ready",
      };
    case "failed":
      return {
        ...state,
        error: action.error,
        captureLease: null,
        executionLease: null,
        executionCountdown: null,
        status: "error",
      };
    case "cleared":
      return createEmptySession();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyType(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 1;
}

function isMode(value: unknown): value is ExecutionMode {
  return value === "review" || value === "fill" || value === "autopilot";
}

function isPreset(value: unknown): value is Preset {
  return value === "job" || value === "lead" || value === "general";
}

function isStrategyId(value: unknown): value is Strategy["id"] {
  return value === "safe" || value === "balanced" || value === "standout";
}

export function isCaptureItem(value: unknown): value is CaptureItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.dataUrl === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,/.test(value.dataUrl) &&
    value.dataUrl.length <= MAX_CAPTURE_DATA_URL_LENGTH &&
    typeof value.sourceUrl === "string" &&
    /^https?:\/\//.test(value.sourceUrl) &&
    value.sourceUrl.length <= 2_048 &&
    typeof value.sourceTitle === "string" &&
    value.sourceTitle.length <= 300 &&
    typeof value.capturedAt === "string" &&
    !Number.isNaN(Date.parse(value.capturedAt)) &&
    (value.kind === "viewport" || value.kind === "region")
  );
}

export function parseConnectorMessage(value: unknown): ConnectorMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  const noPayload = new Set([
    "GET_SESSION",
    "GET_PROVIDER_STATUS",
    "RETEST_PROVIDER_SETTINGS",
    "CLEAR_PROVIDER_SETTINGS",
    "OPEN_PANEL",
    "CAPTURE_VIEWPORT",
    "START_SNIP",
    "CLEAR_SESSION",
    "ANALYZE",
    "EXECUTE",
    "EXECUTE_EXACT_FALLBACK",
    "CANCEL_EXECUTION",
    "UNDO",
    "HIDE_PET",
    "SHOW_PET",
    "CANCEL_SNIP",
    "DISCOVER_FIELDS",
  ]);

  if (noPayload.has(value.type) && hasOnlyType(value)) {
    return value as ConnectorMessage;
  }

  if (
    value.type === "SAVE_AND_TEST_PROVIDER_SETTINGS" &&
    isProviderKeyCandidate(value.openAIApiKey) &&
    (value.exaApiKey === undefined ||
      isProviderKeyCandidate(value.exaApiKey)) &&
    Object.keys(value).every((key) =>
      ["type", "openAIApiKey", "exaApiKey"].includes(key),
    )
  ) {
    return {
      type: value.type,
      openAIApiKey: value.openAIApiKey,
      ...(value.exaApiKey
        ? { exaApiKey: value.exaApiKey as string }
        : {}),
    };
  }

  if (
    value.type === "REMOVE_CAPTURE" &&
    typeof value.captureId === "string" &&
    value.captureId.length > 0 &&
    value.captureId.length <= 120
  ) {
    return { type: value.type, captureId: value.captureId };
  }

  if (
    value.type === "SET_TASK_HINT" &&
    typeof value.taskHint === "string" &&
    value.taskHint.length <= 800
  ) {
    return { type: value.type, taskHint: value.taskHint };
  }

  if (value.type === "SET_PRESET" && isPreset(value.preset)) {
    return { type: value.type, preset: value.preset };
  }

  if (value.type === "SELECT_STRATEGY" && isStrategyId(value.strategyId)) {
    return { type: value.type, strategyId: value.strategyId };
  }

  if (value.type === "SET_MODE" && isMode(value.mode)) {
    return { type: value.type, mode: value.mode };
  }

  if (
    value.type === "FETCH_PAGE_AGENT" &&
    typeof value.body === "string" &&
    value.body.length <= 250_000 &&
    typeof value.executionId === "string" &&
    /^[A-Za-z0-9_-]{8,120}$/.test(value.executionId)
  ) {
    return {
      type: value.type,
      body: value.body,
      executionId: value.executionId,
    };
  }

  if (
    (value.type === "RELEASE_EXECUTION_GUARD" ||
      value.type === "AUTHORIZE_SUBMIT") &&
    typeof value.executionId === "string" &&
    /^[A-Za-z0-9_-]{8,120}$/.test(value.executionId) &&
    (value.type === "RELEASE_EXECUTION_GUARD" ||
      (typeof value.documentId === "string" &&
        /^[A-Za-z0-9_-]{8,120}$/.test(value.documentId)))
  ) {
    return value.type === "RELEASE_EXECUTION_GUARD"
      ? {
          type: value.type,
          executionId: value.executionId,
        }
      : {
          type: value.type,
          executionId: value.executionId,
          documentId: value.documentId as string,
        };
  }

  return null;
}
