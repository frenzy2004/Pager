"use client";

import { useState } from "react";

import {
  type DemoPreset,
  UniversalForm,
} from "@/components/demo/universal-form";
import { MochiOverlay } from "@/components/mochi/mochi-overlay";
import { createDomActionDriver } from "@/lib/mochi/action-driver";
import type {
  ActionDriver,
  ExecutionMode,
  Preset,
  Strategy,
} from "@/lib/mochi/types";

const presets: DemoPreset[] = [
  {
    id: "job",
    shortLabel: "Job application",
    eyebrow: "JOIN THE PRODUCT TEAM",
    title: "Product designer application",
    description:
      "Tell us how you think, what you care about, and why this particular problem feels worth solving.",
    submitLabel: "Send application",
    fields: [
      {
        key: "fullName",
        label: "Full name",
        type: "text",
        required: true,
      },
      {
        key: "email",
        label: "Email address",
        type: "email",
        required: true,
      },
      {
        key: "targetRole",
        label: "Role you are applying for",
        type: "text",
        required: true,
      },
      {
        key: "summary",
        label: "Why are you a strong fit?",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "lead",
    shortLabel: "Sales lead",
    eyebrow: "RESEARCH BEFORE OUTREACH",
    title: "Qualify a promising lead",
    description:
      "Capture the verified signal, the likely problem, and a useful reason to start a human conversation.",
    submitLabel: "Save qualified lead",
    fields: [
      {
        key: "contactName",
        label: "Contact name",
        type: "text",
        required: true,
      },
      {
        key: "workEmail",
        label: "Work email",
        type: "email",
        required: true,
      },
      {
        key: "companyName",
        label: "Company",
        type: "text",
        required: true,
      },
      {
        key: "summary",
        label: "Why is this lead worth pursuing?",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "general",
    shortLabel: "General form",
    eyebrow: "A LITTLE CONTEXT GOES FAR",
    title: "Make a considered request",
    description:
      "Share the request, the context behind it, and the outcome that would make it genuinely useful.",
    submitLabel: "Send request",
    fields: [
      {
        key: "requesterName",
        label: "Your name",
        type: "text",
        required: true,
      },
      {
        key: "replyEmail",
        label: "Reply email",
        type: "email",
        required: true,
      },
      {
        key: "requestType",
        label: "Request category",
        type: "select",
        required: true,
        options: ["Partnership", "Access request", "Feedback", "Other"],
      },
      {
        key: "summary",
        label: "What would you like us to know?",
        type: "textarea",
        required: true,
      },
    ],
  },
];

const orbitWords = ["SCREENSHOT", "UNDERSTAND", "RESEARCH", "REFINE", "ACT"];

function emptyValues(preset: DemoPreset) {
  return Object.fromEntries(preset.fields.map((field) => [field.key, ""]));
}

export function ProductDemo() {
  const [presetId, setPresetId] = useState<Preset>("job");
  const preset = presets.find((item) => item.id === presetId) ?? presets[0];
  const [values, setValues] = useState<Record<string, string>>(() =>
    emptyValues(preset),
  );
  const [undoSnapshot, setUndoSnapshot] = useState<Record<
    string,
    string
  > | null>(null);
  const [filledKeys, setFilledKeys] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [driver] = useState<ActionDriver>(() =>
    createDomActionDriver({
      fill(nextValues) {
        setValues((current) => {
          setUndoSnapshot(current);
          return { ...current, ...nextValues };
        });
        setFilledKeys(Object.keys(nextValues));
        window.setTimeout(() => setFilledKeys([]), 1800);
      },
      submit() {
        setSubmitted(true);
      },
      countdownMs: 3000,
    }),
  );
  const activePresetIndex = presets.findIndex((item) => item.id === presetId);

  const switchPreset = (nextPreset: DemoPreset) => {
    setPresetId(nextPreset.id);
    setValues(emptyValues(nextPreset));
    setUndoSnapshot(null);
    setFilledKeys([]);
    setSubmitted(false);
  };

  const execute = (strategy: Strategy, mode: ExecutionMode) =>
    driver.execute(strategy, mode);

  const undo = () => {
    if (!undoSnapshot) return;
    setValues(undoSnapshot);
    setUndoSnapshot(null);
    setSubmitted(false);
    setFilledKeys([]);
  };

  return (
    <main className="product-demo">
      <nav className="site-nav" aria-label="Primary">
        <a className="wordmark" href="#top" aria-label="Mochi home">
          <span className="wordmark__mark">M</span>
          <span>
            mochi
            <small>CONTEXT THAT CAN ACT</small>
          </span>
        </a>
        <div className="site-nav__status">
          <span>
            <i />
            LIVE PROTOTYPE
          </span>
          <a href="https://github.com/frenzy2004/Pager">VIEW SOURCE ↗</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero__copy">
          <span className="hero-kicker">
            <i>✦</i>
            Your context, finally useful
          </span>
          <h1>
            Show it.
            <br />
            <em>Mochi gets it.</em>
            <br />
            Let it act.
          </h1>
          <p>
            Drop any screenshot into a tiny sidekick. Mochi reads the page,
            researches what is missing, gives you three smart routes, and fills
            the form at exactly your comfort level.
          </p>

          <div className="hero__actions">
            <button
              type="button"
              onClick={() =>
                document
                  .querySelector<HTMLButtonElement>(".mochi-pet-button")
                  ?.click()
              }
            >
              Wake up Mochi
              <span aria-hidden="true">↗</span>
            </button>
            <small>
              No extension needed
              <br />
              for this live demo
            </small>
          </div>

          <div
            className="how-it-works"
            role="list"
            aria-label="How Mochi works"
          >
            {orbitWords.map((word, index) => (
              <span key={word} role="listitem">
                <b>{String(index + 1).padStart(2, "0")}</b>
                {word}
              </span>
            ))}
          </div>
        </div>

        <div className="hero__demo">
          <div className="preset-switcher">
            <span>TRY A MISSION</span>
            <div>
              {presets.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === presetId ? "is-active" : ""}
                  aria-pressed={item.id === presetId}
                  aria-label={item.shortLabel}
                  onClick={() => switchPreset(item)}
                >
                  <b>{index + 1}</b>
                  {item.shortLabel}
                </button>
              ))}
            </div>
            <span className="preset-index">
              0{activePresetIndex + 1} / 03
            </span>
          </div>

          <UniversalForm
            preset={preset}
            values={values}
            filledKeys={filledKeys}
            submitted={submitted}
            onChange={(key, value) =>
              setValues((current) => ({ ...current, [key]: value }))
            }
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
            }}
          />
        </div>
      </section>

      <section
        className="connector-install"
        id="connector"
        aria-labelledby="connector-title"
      >
        <div className="connector-install__copy">
          <span className="hero-kicker">
            <i>✦</i>
            One sidekick, every tab
          </span>
          <h2 id="connector-title" aria-label="Use Mochi across tabs">
            Use Mochi
            <br />
            <em>across tabs.</em>
          </h2>
          <p>
            Add the tiny Chrome connector once. Mochi then appears on eligible
            websites, keeps one shared eight-capture tray while you switch
            tabs, and uses Alibaba Page Agent when you tell it to act.
          </p>
          <div className="connector-install__badges" aria-label="Requirements">
            <span>CHROME 116+</span>
            <span>8 CAPTURES</span>
            <span>NO BROWSER API KEY</span>
          </div>
          <a
            className="connector-download"
            href="/downloads/mochi-connector.zip"
            download
          >
            Download Chrome connector
            <span aria-hidden="true">↓</span>
          </a>
          <small>
            Captures stay local until you press Analyze. OpenAI and Exa keys
            remain on Vercel.
          </small>
        </div>

        <div className="connector-install__demo">
          <div className="connector-browser" aria-hidden="true">
            <div className="connector-browser__bar">
              <i />
              <i />
              <i />
              <span>profile.example / research.example / form.example</span>
            </div>
            <div className="connector-browser__page">
              <span className="connector-context-card connector-context-card--one">
                PROFILE
                <b>01</b>
              </span>
              <span className="connector-context-card connector-context-card--two">
                RESEARCH
                <b>02</b>
              </span>
              <span className="connector-context-card connector-context-card--three">
                FORM
                <b>03</b>
              </span>
              <div className="connector-panel-preview">
                <strong>mochi</strong>
                <small>3 / 8 captures</small>
                <span>Capture page</span>
                <span>Snip area</span>
                <b>M</b>
              </div>
            </div>
          </div>

          <ol className="connector-steps" aria-label="Install the connector">
            <li data-testid="connector-install-step">
              <b>01</b>
              <span>
                <strong>Download + unzip</strong>
                <small>Keep the mochi-connector folder together.</small>
              </span>
            </li>
            <li data-testid="connector-install-step">
              <b>02</b>
              <span>
                <strong>Open chrome://extensions</strong>
                <small>Turn on Developer mode in the top corner.</small>
              </span>
            </li>
            <li data-testid="connector-install-step">
              <b>03</b>
              <span>
                <strong>Choose Load unpacked</strong>
                <small>Select the unzipped folder, then switch tabs.</small>
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section className="trust-strip" aria-label="Product principles">
        <span>01</span>
        <p>
          <strong>Three routes, not one guess.</strong>
          Safe, balanced, and standout.
        </p>
        <span>02</span>
        <p>
          <strong>Three gears of control.</strong>
          Review, fill only, or autopilot.
        </p>
        <span>03</span>
        <p>
          <strong>No invented identity.</strong>
          Unknown facts stay visibly unknown.
        </p>
      </section>

      <MochiOverlay
        key={preset.id}
        fields={preset.fields}
        preset={preset.id}
        onExecute={execute}
        onCancel={() => driver.cancel()}
        onUndo={undo}
        canUndo={Boolean(undoSnapshot)}
      />
    </main>
  );
}
