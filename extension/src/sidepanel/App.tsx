import { useEffect, useState } from "react";

import type {
  ConnectorMessage,
  ConnectorSession,
  ExecutionMode,
  Preset,
  Strategy,
} from "../shared/protocol";
import { createEmptySession } from "../shared/session";

export interface SidePanelRuntime {
  addMessageListener(
    listener: (message: ConnectorMessage) => void,
  ): () => void;
  sendMessage(message: ConnectorMessage): Promise<unknown>;
}

interface AppProps {
  runtime: SidePanelRuntime;
}

interface RuntimeEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const missions: Array<{ value: Preset; label: string }> = [
  { value: "job", label: "Job application" },
  { value: "lead", label: "Sales lead" },
  { value: "general", label: "General form" },
];

const modes: Array<{
  value: ExecutionMode;
  label: string;
  detail: string;
}> = [
  {
    value: "review",
    label: "Review first",
    detail: "Preview only. No page changes.",
  },
  {
    value: "fill",
    label: "Fill only",
    detail: "Fill safe fields. Never submit.",
  },
  {
    value: "autopilot",
    label: "Autopilot",
    detail: "3-second countdown. One submit maximum.",
  },
];

function isSession(value: unknown): value is ConnectorSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "captures" in value &&
    Array.isArray(value.captures) &&
    "executionMode" in value
  );
}

function unwrapRuntimeResponse(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value
  ) {
    const envelope = value as RuntimeEnvelope;
    if (!envelope.ok) {
      throw new Error(envelope.error ?? "Mochi could not finish.");
    }
    return envelope.result;
  }
  return value;
}

export function App({ runtime }: AppProps) {
  const [session, setSession] = useState(createEmptySession);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState("");

  const selectedStrategy =
    session.strategies.find(
      ({ id }) => id === session.selectedStrategyId,
    ) ?? null;

  useEffect(() => {
    let active = true;
    const removeListener = runtime.addMessageListener((message) => {
      if (message.type === "SESSION_UPDATED" && active) {
        setSession(message.session);
      }
    });

    void runtime
      .sendMessage({ type: "GET_SESSION" })
      .then(unwrapRuntimeResponse)
      .then((value) => {
        if (active && isSession(value)) {
          setSession(value);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLocalError(
            error instanceof Error ? error.message : "Mochi could not start.",
          );
        }
      });

    return () => {
      active = false;
      removeListener();
    };
  }, [runtime]);

  const send = async (message: ConnectorMessage) => {
    setWorking(true);
    setLocalError("");
    try {
      const value = unwrapRuntimeResponse(await runtime.sendMessage(message));
      if (isSession(value)) {
        setSession(value);
      }
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Mochi could not finish.",
      );
    } finally {
      setWorking(false);
    }
  };

  const setPreset = (preset: Preset) => {
    setSession((current) => ({ ...current, preset }));
    void send({ type: "SET_PRESET", preset });
  };

  const setMode = (mode: ExecutionMode) => {
    setSession((current) => ({ ...current, executionMode: mode }));
    void send({ type: "SET_MODE", mode });
  };

  const selectStrategy = (strategyId: Strategy["id"]) => {
    setSession((current) => ({ ...current, selectedStrategyId: strategyId }));
    void send({ type: "SELECT_STRATEGY", strategyId });
  };

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <div className="brand-mark" aria-hidden="true">
          M<span>✦</span>
        </div>
        <div>
          <strong>mochi</strong>
          <small>CONTEXT THAT CAN ACT</small>
        </div>
        <i
          className={`status-light status-light--${session.status}`}
          title={session.status}
        />
      </header>

      <section className="mission-section" aria-labelledby="mission-title">
        <span className="eyebrow" id="mission-title">
          Mission
        </span>
        <div className="mission-switch">
          {missions.map((mission) => (
            <label key={mission.value}>
              <input
                type="radio"
                name="mission"
                value={mission.value}
                checked={session.preset === mission.value}
                onChange={() => setPreset(mission.value)}
              />
              <span>{mission.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="capture-section" aria-labelledby="capture-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Context pocket</span>
            <h1 id="capture-title">Capture what matters.</h1>
          </div>
          <b>{session.captures.length} / 8</b>
        </div>

        <div className="capture-actions">
          <button
            type="button"
            className="capture-primary"
            disabled={working || session.captures.length >= 8}
            onClick={() => void send({ type: "CAPTURE_VIEWPORT" })}
          >
            <span aria-hidden="true">▣</span>
            Capture page
          </button>
          <button
            type="button"
            className="capture-secondary"
            disabled={working || session.captures.length >= 8}
            onClick={() => void send({ type: "START_SNIP" })}
          >
            <span aria-hidden="true">⌗</span>
            Snip area
          </button>
        </div>

        {session.captures.length > 0 ? (
          <>
            <div className="capture-list" aria-label="Captured context">
              {session.captures.map((capture, index) => (
                <article className="capture-card" key={capture.id}>
                  {/* The pixels remain local until the user presses Analyze. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- Extension data URLs cannot use Next Image. */}
                  <img src={capture.dataUrl} alt="" />
                  <div>
                    <strong>{capture.sourceTitle}</strong>
                    <small>
                      {new URL(capture.sourceUrl).hostname} ·{" "}
                      {capture.kind === "region" ? "snip" : "viewport"}
                    </small>
                  </div>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${capture.sourceTitle}`}
                    onClick={() =>
                      void send({
                        type: "REMOVE_CAPTURE",
                        captureId: capture.id,
                      })
                    }
                  >
                    ×
                  </button>
                </article>
              ))}
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => void send({ type: "CLEAR_SESSION" })}
            >
              Clear all
            </button>
          </>
        ) : (
          <div className="empty-pocket">
            <span aria-hidden="true">✦</span>
            <p>
              Capture this page, then switch tabs and capture again.
              <small>The same tray follows you.</small>
            </p>
          </div>
        )}

        <label className="task-hint">
          <span>
            Direction <small>optional</small>
          </span>
          <textarea
            maxLength={800}
            value={session.taskHint}
            placeholder="e.g. Keep this warm, concise, and grounded in the screenshots…"
            onChange={(event) => {
              const taskHint = event.target.value;
              setSession((current) => ({ ...current, taskHint }));
            }}
            onBlur={() =>
              void send({
                type: "SET_TASK_HINT",
                taskHint: session.taskHint,
              })
            }
          />
        </label>

        <button
          className="analyze-button"
          type="button"
          disabled={working || session.captures.length === 0}
          onClick={() => void send({ type: "ANALYZE" })}
        >
          {session.status === "analyzing" ? "Mochi is thinking…" : "Analyze context"}
          <span aria-hidden="true">↗</span>
        </button>
        <p className="privacy-line">
          <span aria-hidden="true">⌁</span>
          Captures stay local until Analyze.
        </p>
      </section>

      {session.strategies.length === 3 && (
        <section className="strategy-section" aria-labelledby="strategy-title">
          <span className="eyebrow">Three routes</span>
          <h2 id="strategy-title">Choose your move.</h2>
          <div className="strategy-list">
            {session.strategies.map((strategy) => (
              <button
                type="button"
                data-testid="connector-strategy"
                className={`strategy-card strategy-card--${strategy.accent} ${
                  strategy.id === session.selectedStrategyId
                    ? "is-selected"
                    : ""
                }`}
                key={strategy.id}
                onClick={() => selectStrategy(strategy.id)}
              >
                <span>{strategy.eyebrow}</span>
                <strong>{strategy.label}</strong>
                <p>{strategy.rationale}</p>
                <b>{Math.round(strategy.confidence * 100)}%</b>
              </button>
            ))}
          </div>

          <fieldset className="mode-list">
            <legend className="eyebrow">Comfort level</legend>
            {modes.map((mode) => (
              <label key={mode.value}>
                <input
                  type="radio"
                  name="execution-mode"
                  checked={session.executionMode === mode.value}
                  onChange={() => setMode(mode.value)}
                />
                <span>
                  <strong>{mode.label}</strong>
                  <small>{mode.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <button
            className="execute-button"
            type="button"
            disabled={!selectedStrategy || working}
            onClick={() => void send({ type: "EXECUTE" })}
          >
            {session.executionCountdown
              ? `Autopilot in ${session.executionCountdown}…`
              : `Execute with ${selectedStrategy?.label ?? "selected route"}`}
            <span aria-hidden="true">↗</span>
          </button>

          {session.status === "executing" && (
            <button
              className="cancel-button"
              type="button"
              onClick={() => void send({ type: "CANCEL_EXECUTION" })}
            >
              Cancel execution
            </button>
          )}
          {session.lastExecution && (
            <button
              className="text-button"
              type="button"
              onClick={() => void send({ type: "UNDO" })}
            >
              Undo last fill
            </button>
          )}
        </section>
      )}

      {(localError || session.error) && (
        <p className="panel-error" role="alert">
          <b>!</b>
          {localError || session.error}
        </p>
      )}
    </main>
  );
}
