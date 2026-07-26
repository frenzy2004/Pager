import { describe, expect, it } from "vitest";

import {
  createEmptySession,
  parseConnectorMessage,
  reduceSession,
} from "./session";
import type { CaptureItem, Strategy } from "./protocol";

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

describe("connector session", () => {
  it("starts safe and empty", () => {
    expect(createEmptySession()).toEqual({
      captures: [],
      preset: "general",
      taskHint: "",
      strategies: [],
      selectedStrategyId: null,
      executionMode: "review",
      status: "idle",
      error: null,
      lastExecution: null,
      executionCountdown: null,
    });
  });

  it("keeps the newest eight captures and removes selected captures", () => {
    let state = createEmptySession();

    for (let index = 0; index < 9; index += 1) {
      state = reduceSession(state, {
        type: "capture-added",
        capture: capture(index),
      });
    }

    expect(state.captures.map(({ id }) => id)).toEqual([
      "capture-1",
      "capture-2",
      "capture-3",
      "capture-4",
      "capture-5",
      "capture-6",
      "capture-7",
      "capture-8",
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
      selectedStrategyId: "safe",
      executionMode: "fill",
      preset: "lead",
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
});
