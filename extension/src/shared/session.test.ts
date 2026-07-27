import { describe, expect, it } from "vitest";

import {
  createEmptySession,
  parseConnectorMessage,
  reduceSession,
} from "./session";
import type {
  AnalysisTarget,
  CaptureItem,
  Strategy,
} from "./protocol";

function capture(index: number): CaptureItem {
  return {
    id: `capture-${index}`,
    dataUrl: `data:image/jpeg;base64,${"a".repeat(20)}`,
    sourceUrl: `https://example.com/page-${index}`,
    sourceTitle: `Page ${index}`,
    capturedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
    kind: index % 2 === 0 ? "viewport" : "region",
  };
}

const strategies: Strategy[] = [
  {
    id: "safe",
    label: "Safe & precise",
    eyebrow: "Verified details",
    rationale: "Use only supported facts.",
    confidence: 0.94,
    accent: "sage",
    fields: {},
    sources: [],
  },
  {
    id: "balanced",
    label: "Balanced",
    eyebrow: "Best overall",
    rationale: "Blend facts and careful drafts.",
    confidence: 0.87,
    accent: "violet",
    fields: {},
    sources: [],
  },
  {
    id: "standout",
    label: "Standout",
    eyebrow: "More expressive",
    rationale: "Use a stronger voice.",
    confidence: 0.79,
    accent: "coral",
    fields: {},
    sources: [],
  },
];
const analysisTarget: AnalysisTarget = {
  tabId: 7,
  windowId: 3,
  tabUrl: "https://forms.example.test/apply",
  documentId: "document-original",
  fieldManifestKey: "[]",
};

describe("connector session", () => {
  it("starts safe and empty", () => {
    expect(createEmptySession()).toEqual({
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
    });
  });

  it("keeps the first eight captures until the user removes one", () => {
    let state = createEmptySession();

    for (let index = 0; index < 9; index += 1) {
      state = reduceSession(state, {
        type: "capture-added",
        capture: capture(index),
      });
    }

    expect(state.captures.map(({ id }) => id)).toEqual([
      "capture-0",
      "capture-1",
      "capture-2",
      "capture-3",
      "capture-4",
      "capture-5",
      "capture-6",
      "capture-7",
    ]);

    state = reduceSession(state, {
      type: "capture-removed",
      captureId: "capture-4",
    });
    expect(state.captures.some(({ id }) => id === "capture-4")).toBe(false);
  });

  it("selects strategies, changes modes, stores errors, and clears", () => {
    let state = reduceSession(createEmptySession(), {
      type: "analysis-succeeded",
      strategies,
      target: analysisTarget,
    });

    expect(state.selectedStrategyId).toBe("balanced");
    expect(state.status).toBe("ready");

    state = reduceSession(state, {
      type: "strategy-selected",
      strategyId: "safe",
    });
    state = reduceSession(state, { type: "mode-changed", mode: "fill" });
    state = reduceSession(state, { type: "preset-changed", preset: "lead" });
    state = reduceSession(state, {
      type: "failed",
      error: "The active page is unsupported.",
    });

    expect(state).toMatchObject({
      selectedStrategyId: null,
      executionMode: "fill",
      preset: "lead",
      strategies: [],
      status: "error",
      error: "The active page is unsupported.",
    });

    expect(reduceSession(state, { type: "cleared" })).toEqual(
      createEmptySession(),
    );
  });

  it("accepts only bounded messages with known discriminants", () => {
    expect(parseConnectorMessage({ type: "GET_SESSION" })).toEqual({
      type: "GET_SESSION",
    });
    expect(
      parseConnectorMessage({
        type: "REMOVE_CAPTURE",
        captureId: "capture-1",
      }),
    ).toEqual({
      type: "REMOVE_CAPTURE",
      captureId: "capture-1",
    });
    expect(parseConnectorMessage({ type: "REMOVE_CAPTURE" })).toBeNull();
    expect(
      parseConnectorMessage({
        type: "FETCH_PAGE_AGENT",
        url: "https://evil.test",
      }),
    ).toBeNull();
    expect(parseConnectorMessage({ type: "UNKNOWN" })).toBeNull();
    expect(parseConnectorMessage(null)).toBeNull();
  });

  it("invalidates exact-fill approval whenever its reviewed context changes", () => {
    const offer = {
      tabId: 7,
      windowId: 3,
      tabUrl: "https://forms.example.test/apply",
      documentId: "document-original",
      fieldManifestKey: "[]",
      strategy: strategies[1]!,
      reason: "Provider offline",
    };
    const ready = reduceSession(
      reduceSession(createEmptySession(), {
        type: "analysis-succeeded",
        strategies,
        target: analysisTarget,
      }),
      { type: "fallback-offered", offer },
    );

    expect(
      reduceSession(ready, {
        type: "strategy-selected",
        strategyId: "safe",
      }).fallbackOffer,
    ).toBeNull();
    expect(
      reduceSession(ready, {
        type: "task-hint-changed",
        taskHint: "Use another source",
      }).fallbackOffer,
    ).toBeNull();
    expect(
      reduceSession(ready, {
        type: "capture-added",
        capture: capture(1),
      }).fallbackOffer,
    ).toBeNull();
    expect(
      reduceSession(ready, { type: "analysis-started" }).fallbackOffer,
    ).toBeNull();
  });
});
