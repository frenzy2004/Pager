"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ContextTray,
  MAX_CONTEXT_SCREENSHOTS,
  type ScreenshotPreview,
} from "@/components/mochi/context-tray";
import { ModeSwitcher } from "@/components/mochi/mode-switcher";
import { MochiFace } from "@/components/mochi/mochi-face";
import { MochiPet } from "@/components/mochi/mochi-pet";
import { StrategyPicker } from "@/components/mochi/strategy-picker";
import { validateScreenshot } from "@/lib/mochi/files";
import type {
  AnalysisResult,
  ExecutionMode,
  ExecutionResult,
  PageField,
  Preset,
  Strategy,
} from "@/lib/mochi/types";

const SAMPLE_CONTEXT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0YAAAAASUVORK5CYII=";

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

type OverlayPhase = "context" | "analyzing" | "results" | "review" | "success";

interface MochiOverlayProps {
  fields: PageField[];
  preset: Preset;
  onExecute(
    strategy: Strategy,
    mode: ExecutionMode,
  ): Promise<ExecutionResult>;
  onCancel?: () => void;
  onUndo(): void;
  canUndo: boolean;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that screenshot."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function createSampleContext() {
  if (
    typeof document === "undefined" ||
    navigator.userAgent.toLowerCase().includes("jsdom")
  ) {
    return SAMPLE_CONTEXT;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const context = canvas.getContext("2d");
  if (!context) return SAMPLE_CONTEXT;

  context.fillStyle = "#f4f0e8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#7467f5";
  context.fillRect(0, 0, canvas.width, 118);
  context.fillStyle = "#fffdf8";
  context.font = "700 25px system-ui";
  context.fillText("CONTEXT SNAPSHOT · SAMPLE", 66, 71);

  context.fillStyle = "#1d1d1a";
  context.font = "700 52px system-ui";
  context.fillText("Jamie Chen", 66, 210);
  context.font = "400 30px system-ui";
  context.fillStyle = "#5f5d56";
  context.fillText("Product designer · B2B SaaS", 66, 258);

  const cards = [
    ["EXPERIENCE", "8 years shaping complex products into simple workflows"],
    ["PROOF", "Led onboarding redesign used by 120k customer teams"],
    ["CRITERIA", "Systems thinking · collaboration · measurable outcomes"],
    ["VOICE", "Warm, concise, and specific — never overclaim"],
  ];
  cards.forEach(([label, value], index) => {
    const y = 326 + index * 94;
    context.fillStyle = index % 2 === 0 ? "#fffdf8" : "#ece9ff";
    context.fillRect(66, y, 1068, 70);
    context.fillStyle = "#7467f5";
    context.font = "700 18px system-ui";
    context.fillText(label, 92, y + 29);
    context.fillStyle = "#1d1d1a";
    context.font = "500 22px system-ui";
    context.fillText(value, 280, y + 30);
  });

  return canvas.toDataURL("image/png");
}

const progressStages = [
  ["Seeing the page", "Mapping fields and visible criteria"],
  ["Reading your context", "Finding facts, signals, and constraints"],
  ["Searching the gaps", "Public research only when it helps"],
  ["Crafting three routes", "Safe, balanced, and standout"],
] as const;

export function MochiOverlay({
  fields,
  preset,
  onExecute,
  onCancel,
  onUndo,
  canUndo,
}: MochiOverlayProps) {
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<OverlayPhase>("context");
  const [screenshots, setScreenshots] = useState<ScreenshotPreview[]>([]);
  const [taskHint, setTaskHint] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedId, setSelectedId] = useState<Strategy["id"]>("balanced");
  const [mode, setMode] = useState<ExecutionMode>("review");
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const selectedStrategy = useMemo(
    () =>
      analysis?.strategies.find((strategy) => strategy.id === selectedId) ??
      analysis?.strategies[1],
    [analysis, selectedId],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setError("");
      const slots = Math.max(
        0,
        MAX_CONTEXT_SCREENSHOTS - screenshots.length,
      );
      if (slots === 0) {
        setError(
          `Mochi can hold ${MAX_CONTEXT_SCREENSHOTS} screenshots at a time.`,
        );
        return;
      }

      const next: ScreenshotPreview[] = [];
      for (const file of files.slice(0, slots)) {
        const validation = validateScreenshot(file);
        if (!validation.ok) {
          setError(validation.error);
          continue;
        }

        try {
          next.push({
            id: `${file.name}-${file.lastModified}-${crypto.randomUUID?.() ?? Date.now()}`,
            name: file.name,
            dataUrl: await fileToDataUrl(file),
          });
        } catch (fileError) {
          setError(
            fileError instanceof Error
              ? fileError.message
              : "Could not read that screenshot.",
          );
        }
      }

      setScreenshots((current) =>
        [...current, ...next].slice(0, MAX_CONTEXT_SCREENSHOTS),
      );
    },
    [screenshots.length],
  );

  useEffect(() => {
    if (!open) return;

    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (pasted.length) {
        event.preventDefault();
        void addFiles(pasted);
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, open]);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  const reset = () => {
    setPhase("context");
    setAnalysis(null);
    setExecution(null);
    setProgress(0);
    setCountdown(null);
    setError("");
  };

  const analyze = async () => {
    setError("");
    setPhase("analyzing");
    setProgress(0);

    const interval = window.setInterval(() => {
      setProgress((current) => Math.min(3, current + 1));
    }, 700);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset,
          taskHint,
          screenshots: screenshots.map(({ name, dataUrl }) => ({
            name,
            dataUrl,
          })),
          fields,
        }),
      });
      const body = (await response.json()) as
        | AnalysisResult
        | { error?: string; detail?: string };

      if (!response.ok || !("strategies" in body)) {
        throw new Error(
          "error" in body && body.error
            ? `${body.error}${body.detail ? ` ${body.detail}` : ""}`
            : "Mochi could not understand that context.",
        );
      }

      setAnalysis(body);
      setSelectedId("balanced");
      setPhase("results");
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Mochi could not understand that context.",
      );
      setPhase("context");
    } finally {
      window.clearInterval(interval);
    }
  };

  const act = async (forceMode?: ExecutionMode) => {
    if (!selectedStrategy) return;
    const actionMode = forceMode ?? mode;
    setBusy(true);
    setError("");

    if (actionMode === "autopilot") {
      setCountdown(3);
      const interval = window.setInterval(() => {
        setCountdown((current) =>
          current === null ? null : Math.max(0, current - 1),
        );
      }, 1000);

      const result = await onExecute(selectedStrategy, actionMode);
      window.clearInterval(interval);
      setCountdown(null);
      setExecution(result);
      setBusy(false);
      if (result.status === "cancelled") {
        setPhase("results");
      } else {
        setPhase("success");
      }
      return;
    }

    const result = await onExecute(selectedStrategy, actionMode);
    setExecution(result);
    setBusy(false);
    setPhase(result.status === "preview" ? "review" : "success");
  };

  const cancelAutopilot = () => {
    onCancel?.();
    setCountdown(null);
  };

  const primaryLabel =
    mode === "review"
      ? "Review changes"
      : mode === "fill"
        ? "Fill this page"
        : "Start autopilot";

  return (
    <>
      <MochiPet
        open={open}
        disabled={!mounted}
        onToggle={() => setOpen((current) => !current)}
      />

      {open && (
        <aside
          className="mochi-overlay"
          role="dialog"
          aria-modal="false"
          aria-label="Mochi context assistant"
        >
          <header className="mochi-overlay__header">
            <div className="mochi-overlay__identity">
              <MochiFace small />
              <span>
                <strong>Mochi</strong>
                <small>
                  {phase === "analyzing" ? "thinking out loud…" : "ready to help"}
                </small>
              </span>
            </div>
            <div className="mochi-overlay__header-actions">
              {analysis && (
                <span className={`engine-chip engine-chip--${analysis.engine}`}>
                  {analysis.engine === "demo" ? "DEMO" : "LIVE"}
                </span>
              )}
              <button
                ref={closeButtonRef}
                type="button"
                className="icon-button"
                aria-label="Close Mochi"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </header>

          <div className="mochi-overlay__body">
            {phase === "context" && (
              <section className="overlay-section overlay-section--context">
                <span className="section-kicker">
                  <i aria-hidden="true" />
                  Context pocket
                </span>
                <h2>
                  Show me what
                  <br />
                  <em>you know.</em>
                </h2>
                <p className="section-intro">
                  Paste or drop screenshots. I&apos;ll connect them to this page
                  and keep uncertain facts honest.
                </p>

                <ContextTray
                  screenshots={screenshots}
                  onFiles={(files) => void addFiles(files)}
                  onRemove={(id) =>
                    setScreenshots((current) =>
                      current.filter((item) => item.id !== id),
                    )
                  }
                  onSample={() =>
                    setScreenshots([
                      {
                        id: "sample-context",
                        name: "sample-context.png",
                        dataUrl: createSampleContext(),
                      },
                    ])
                  }
                />

                <label className="task-hint">
                  <span>
                    Anything else? <small>optional</small>
                  </span>
                  <textarea
                    value={taskHint}
                    maxLength={800}
                    placeholder="e.g. Keep it warm, concise, and focused on product impact…"
                    onChange={(event) => setTaskHint(event.target.value)}
                  />
                </label>

                {error && (
                  <p className="overlay-error" role="alert">
                    <span aria-hidden="true">!</span>
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  className="mochi-primary"
                  onClick={() => void analyze()}
                >
                  <span>Analyze context</span>
                  <b aria-hidden="true">↗</b>
                </button>
                <p className="privacy-note">
                  <span aria-hidden="true">⌁</span>
                  Screenshots stay in this session. No mystery memory.
                </p>
              </section>
            )}

            {phase === "analyzing" && (
              <section className="overlay-section analyzing-view">
                <div className="thinking-orbit" aria-hidden="true">
                  <MochiFace />
                  <span />
                  <span />
                  <span />
                </div>
                <span className="section-kicker">
                  <i aria-hidden="true" />
                  Making sense of it
                </span>
                <h2>
                  Tiny paws,
                  <br />
                  <em>big context.</em>
                </h2>
                <div className="progress-list" aria-live="polite">
                  {progressStages.map(([title, detail], index) => (
                    <div
                      key={title}
                      className={
                        index < progress
                          ? "is-done"
                          : index === progress
                            ? "is-current"
                            : ""
                      }
                    >
                      <span>{index < progress ? "✓" : index + 1}</span>
                      <p>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {phase === "results" && analysis && (
              <section className="overlay-section overlay-section--results">
                <div className="result-heading">
                  <div>
                    <span className="section-kicker">
                      <i aria-hidden="true" />
                      Three good routes
                    </span>
                    <h2>
                      Pick your
                      <br />
                      <em>best angle.</em>
                    </h2>
                  </div>
                  <button type="button" onClick={reset}>
                    New context
                  </button>
                </div>
                <p className="page-summary">{analysis.pageSummary}</p>
                <div className="analysis-notice">
                  <span aria-hidden="true">
                    {analysis.engine === "demo" ? "◌" : "●"}
                  </span>
                  <p>{analysis.notice}</p>
                </div>

                <StrategyPicker
                  strategies={analysis.strategies}
                  selectedId={selectedId}
                  fields={fields}
                  onSelect={setSelectedId}
                />
                <ModeSwitcher value={mode} onChange={setMode} />

                {countdown !== null ? (
                  <div className="autopilot-countdown" aria-live="assertive">
                    <span>{countdown}</span>
                    <p>
                      <strong>Autopilot is taking the wheel</strong>
                      <small>Filling now, then submitting this demo form.</small>
                    </p>
                    <button type="button" onClick={cancelAutopilot}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mochi-primary"
                    disabled={busy}
                    onClick={() => void act()}
                  >
                    <span>{busy ? "Working…" : primaryLabel}</span>
                    <b aria-hidden="true">↗</b>
                  </button>
                )}
              </section>
            )}

            {phase === "review" && selectedStrategy && (
              <section className="overlay-section review-view">
                <span className="section-kicker">
                  <i aria-hidden="true" />
                  Ready for your approval
                </span>
                <h2>
                  Nothing moves
                  <br />
                  <em>without you.</em>
                </h2>
                <p className="section-intro">
                  Mochi prepared the changes below but has not touched the page.
                </p>
                <div className="review-card">
                  {fields.map((field) => {
                    const value = selectedStrategy.fields[field.key]?.value;
                    return (
                      <div key={field.key}>
                        <span>{field.label}</span>
                        <p>{value || "Leave blank — needs your input"}</p>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="mochi-primary"
                  disabled={busy}
                  onClick={() => void act("fill")}
                >
                  <span>{busy ? "Filling…" : "Approve and fill"}</span>
                  <b aria-hidden="true">✓</b>
                </button>
                <button
                  type="button"
                  className="mochi-secondary"
                  onClick={() => setPhase("results")}
                >
                  Go back
                </button>
              </section>
            )}

            {phase === "success" && execution && (
              <section className="overlay-section success-view" aria-live="polite">
                <div className="success-burst" aria-hidden="true">
                  <MochiFace />
                  <span>✦</span>
                  <span>✦</span>
                  <span>✦</span>
                </div>
                <span className="section-kicker">
                  <i aria-hidden="true" />
                  {execution.adapter === "dom" ? "DOM demo driver" : "Page Agent"}
                </span>
                <h2>
                  {execution.status === "submitted" ? (
                    <>
                      Filled and
                      <br />
                      <em>sent.</em>
                    </>
                  ) : (
                    <>
                      Page filled,
                      <br />
                      <em>your move.</em>
                    </>
                  )}
                </h2>
                <p className="section-intro">
                  {execution.status === "submitted"
                    ? "The hosted demo submitted successfully. Real websites stay behind your chosen permission mode."
                    : "Mochi changed the page and left the final decision with you."}
                </p>
                {canUndo && (
                  <button
                    type="button"
                    className="mochi-primary"
                    onClick={() => {
                      onUndo();
                      setPhase("results");
                    }}
                  >
                    <span>Undo page changes</span>
                    <b aria-hidden="true">↶</b>
                  </button>
                )}
                <button type="button" className="mochi-secondary" onClick={reset}>
                  Start another run
                </button>
              </section>
            )}
          </div>
        </aside>
      )}

      <span className="sr-only" aria-live="polite">
        {error ||
          (phase === "success" && execution
            ? `Mochi action complete: ${execution.status}`
            : "")}
      </span>
    </>
  );
}
