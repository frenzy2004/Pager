import { useEffect, useState } from "react";

import type {
  ConnectorMessage,
  ConnectorSession,
  ExecutionMode,
  Preset,
  ProviderStatus,
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

interface ExecutionPreview {
  status: "preview";
  values: Record<string, string>;
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

function isProviderStatus(value: unknown): value is ProviderStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "configured" in value &&
    typeof value.configured === "boolean" &&
    "openAI" in value &&
    (value.openAI === "missing" ||
      value.openAI === "untested" ||
      value.openAI === "valid" ||
      value.openAI === "invalid") &&
    "exa" in value &&
    (value.exa === "missing" ||
      value.exa === "untested" ||
      value.exa === "valid" ||
      value.exa === "invalid")
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

function isExecutionPreview(value: unknown): value is ExecutionPreview {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "preview" &&
    "values" in value &&
    typeof value.values === "object" &&
    value.values !== null
  );
}

interface ProviderSetupProps {
  onClear(): Promise<void>;
  onClose?(): void;
  onRetest(): Promise<void>;
  onSave(openAIApiKey: string, exaApiKey?: string): Promise<void>;
  settingsMode: boolean;
  status: ProviderStatus;
  working: boolean;
}

function ProviderSetup({
  onClear,
  onClose,
  onRetest,
  onSave,
  settingsMode,
  status,
  working,
}: ProviderSetupProps) {
  const [replacing, setReplacing] = useState(false);
  const [openAIApiKey, setOpenAIApiKey] = useState("");
  const [exaApiKey, setExaApiKey] = useState("");
  const showForm = !settingsMode || replacing;

  if (!showForm) {
    return (
      <section
        className="provider-setup"
        aria-labelledby="provider-settings-title"
      >
        <span className="eyebrow">Provider settings</span>
        <h1 id="provider-settings-title">Your connection.</h1>
        <div className="provider-status-list">
          <p>
            OpenAI:{" "}
            <strong>
              {status.openAI === "valid" ? "connected" : status.openAI}
            </strong>
          </p>
          <p>
            Exa:{" "}
            <strong>
              {status.exa === "valid"
                ? "connected"
                : status.exa === "missing"
                  ? "not configured"
                  : status.exa}
            </strong>
          </p>
        </div>
        <div className="provider-settings-actions">
          <button
            type="button"
            disabled={working}
            onClick={() => void onRetest()}
          >
            Retest
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => setReplacing(true)}
          >
            Replace keys
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={working}
            onClick={() => void onClear()}
          >
            Clear keys
          </button>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={onClose}
        >
          Back to Mochi
        </button>
      </section>
    );
  }

  return (
    <section className="provider-setup" aria-labelledby="provider-setup-title">
      <span className="eyebrow">
        {settingsMode ? "Replace provider keys" : "First-time setup"}
      </span>
      <h1 id="provider-setup-title">
        {settingsMode ? "Replace your keys." : "Add your own key."}
      </h1>
      <p className="provider-intro">
        OpenAI is required. Exa is optional public-web research.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(
            openAIApiKey,
            exaApiKey.trim() || undefined,
          ).then(() => {
            setOpenAIApiKey("");
            setExaApiKey("");
            setReplacing(false);
          });
        }}
      >
        <label>
          <span>OpenAI API key</span>
          <input
            type="password"
            autoComplete="off"
            minLength={8}
            maxLength={512}
            required
            value={openAIApiKey}
            onChange={(event) => setOpenAIApiKey(event.target.value)}
            placeholder="sk-…"
          />
        </label>
        <label>
          <span>Exa API key (optional)</span>
          <input
            type="password"
            autoComplete="off"
            minLength={8}
            maxLength={512}
            value={exaApiKey}
            onChange={(event) => setExaApiKey(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <button
          className="provider-save-button"
          type="submit"
          disabled={working || openAIApiKey.trim().length < 8}
        >
          {working ? "Testing…" : "Save & test"}
        </button>
      </form>
      <p className="provider-warning">
        Stored only in this Chrome profile and sent directly to the provider.
        For this personal unpacked extension, use a revocable project key with
        a spending limit.
      </p>
      <div className="provider-links">
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          Get an OpenAI key ↗
        </a>
        <a
          href="https://dashboard.exa.ai/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          Get an Exa key ↗
        </a>
      </div>
      {settingsMode && (
        <button
          className="text-button"
          type="button"
          onClick={() => setReplacing(false)}
        >
          Cancel replacement
        </button>
      )}
    </section>
  );
}

export function App({ runtime }: AppProps) {
  const [session, setSession] = useState(createEmptySession);
  const [providerStatus, setProviderStatus] =
    useState<ProviderStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState<ExecutionPreview | null>(null);

  const selectedStrategy =
    session.strategies.find(
      ({ id }) => id === session.selectedStrategyId,
    ) ?? null;

  useEffect(() => {
    let active = true;
    const removeListener = runtime.addMessageListener((message) => {
      if (message.type === "SESSION_UPDATED" && active) {
        setSession(message.session);
        setPreview(null);
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

    void runtime
      .sendMessage({ type: "GET_PROVIDER_STATUS" })
      .then(unwrapRuntimeResponse)
      .then((value) => {
        if (active && isProviderStatus(value)) {
          setProviderStatus(value);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLocalError(
            error instanceof Error
              ? error.message
              : "Mochi could not load provider settings.",
          );
        }
      });

    return () => {
      active = false;
      removeListener();
    };
  }, [runtime]);

  const send = async (message: ConnectorMessage): Promise<unknown> => {
    setWorking(true);
    setLocalError("");
    try {
      const value = unwrapRuntimeResponse(await runtime.sendMessage(message));
      if (isSession(value)) {
        setSession(value);
      } else if (isExecutionPreview(value)) {
        setPreview(value);
      } else if (isProviderStatus(value)) {
        setProviderStatus(value);
      }
      return value;
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Mochi could not finish.",
      );
      return undefined;
    } finally {
      setWorking(false);
    }
  };

  const setPreset = (preset: Preset) => {
    setPreview(null);
    setSession((current) => ({ ...current, preset }));
    void send({ type: "SET_PRESET", preset });
  };

  const setMode = (mode: ExecutionMode) => {
    setPreview(null);
    setSession((current) => ({ ...current, executionMode: mode }));
    void send({ type: "SET_MODE", mode });
  };

  const selectStrategy = (strategyId: Strategy["id"]) => {
    setPreview(null);
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
        <div className="panel-header-actions">
          {providerStatus?.configured && (
            <button
              className="settings-button"
              type="button"
              aria-label="Provider settings"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
          )}
          <i
            className={`status-light status-light--${session.status}`}
            title={session.status}
          />
        </div>
      </header>

      {providerStatus === null ? (
        <section className="provider-loading" aria-live="polite">
          <span aria-hidden="true">✦</span>
          Loading Mochi…
        </section>
      ) : !providerStatus.configured || settingsOpen ? (
        <ProviderSetup
          status={providerStatus}
          settingsMode={settingsOpen && providerStatus.configured}
          working={working}
          onClose={() => setSettingsOpen(false)}
          onSave={async (openAIApiKey, exaApiKey) => {
            const value = await send({
              type: "SAVE_AND_TEST_PROVIDER_SETTINGS",
              openAIApiKey,
              ...(exaApiKey ? { exaApiKey } : {}),
            });
            if (isProviderStatus(value) && value.configured) {
              setSettingsOpen(false);
            }
          }}
          onRetest={async () => {
            await send({ type: "RETEST_PROVIDER_SETTINGS" });
          }}
          onClear={async () => {
            await send({ type: "CLEAR_PROVIDER_SETTINGS" });
            setSettingsOpen(false);
          }}
        />
      ) : (
        <>
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
              setPreview(null);
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
              : session.executionMode === "review"
                ? `Preview ${selectedStrategy?.label ?? "selected route"}`
                : `Execute with ${selectedStrategy?.label ?? "selected route"}`}
            <span aria-hidden="true">↗</span>
          </button>

          {preview && (
            <div className="execution-preview" aria-label="Proposed field values">
              <strong>Review these proposed values</strong>
              {Object.entries(preview.values).length > 0 ? (
                <dl>
                  {Object.entries(preview.values).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/[_-]+/g, " ")}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No supported values are ready for this form.</p>
              )}
            </div>
          )}

          {session.status === "executing" && (
            <button
              className="cancel-button"
              type="button"
              onClick={() => void send({ type: "CANCEL_EXECUTION" })}
            >
              Cancel execution
            </button>
          )}
          {session.lastExecution?.status === "submitted" && (
            <p className="execution-note">
              Mochi submitted this form once. A web submission cannot be
              reversed with Undo.
            </p>
          )}
          {session.lastExecution?.status === "filled" && (
            <>
              {session.lastExecution.warning && (
                <p className="execution-note">
                  {session.lastExecution.warning}
                </p>
              )}
              <button
                className="text-button"
                type="button"
                onClick={() => void send({ type: "UNDO" })}
              >
                Undo last fill
              </button>
            </>
          )}
          {session.fallbackOffer && (
            <div className="fallback-offer">
              <strong>Page Agent stopped safely.</strong>
              <p>
                No partial changes remain. Exact fill uses only Mochi&apos;s
                visible safe-field map and never submits.
              </p>
              <button
                className="execute-button"
                type="button"
                disabled={working}
                onClick={() =>
                  void send({ type: "EXECUTE_EXACT_FALLBACK" })
                }
              >
                Approve safe exact fill
              </button>
            </div>
          )}
        </section>
      )}
        </>
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
