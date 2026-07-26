import type { FormEvent } from "react";

import type { PageField, Preset } from "@/lib/mochi/types";

export interface DemoPreset {
  id: Preset;
  shortLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  submitLabel: string;
  fields: PageField[];
}

interface UniversalFormProps {
  preset: DemoPreset;
  values: Record<string, string>;
  filledKeys: string[];
  submitted: boolean;
  onChange(key: string, value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function UniversalForm({
  preset,
  values,
  filledKeys,
  submitted,
  onChange,
  onSubmit,
}: UniversalFormProps) {
  return (
    <section className="form-stage" aria-label={`${preset.shortLabel} demo form`}>
      <div className="form-stage__chrome">
        <div>
          <span />
          <span />
          <span />
        </div>
        <p>forms.northstar.test/{preset.id}</p>
        <span className="secure-tag">⌁ secure</span>
      </div>

      <form className="demo-form" onSubmit={onSubmit}>
        <div className="demo-form__brand">
          <span className="northstar-mark" aria-hidden="true">
            N
          </span>
          <p>
            NORTHSTAR
            <small>STUDIO</small>
          </p>
          <span className="form-step">STEP 2 OF 3</span>
        </div>

        {submitted ? (
          <div className="submitted-state" role="status">
            <span aria-hidden="true">✓</span>
            <p>
              <strong>Demo submitted</strong>
              <small>
                Mochi completed the hosted example. No external form was sent.
              </small>
            </p>
          </div>
        ) : (
          <>
            <header className="demo-form__heading">
              <span>{preset.eyebrow}</span>
              <h2>{preset.title}</h2>
              <p>{preset.description}</p>
            </header>

            <div className="demo-form__fields">
              {preset.fields.map((field) => (
                <label
                  key={field.key}
                  className={`${field.type === "textarea" ? "is-wide" : ""}${
                    filledKeys.includes(field.key) ? " is-mochi-filled" : ""
                  }`}
                >
                  <span>
                    {field.label}
                    {!field.required && <small>optional</small>}
                  </span>
                  {field.type === "textarea" ? (
                    <textarea
                      value={values[field.key] ?? ""}
                      required={field.required}
                      rows={5}
                      placeholder="Type your answer…"
                      onChange={(event) =>
                        onChange(field.key, event.target.value)
                      }
                    />
                  ) : field.type === "select" ? (
                    <select
                      value={values[field.key] ?? ""}
                      required={field.required}
                      onChange={(event) =>
                        onChange(field.key, event.target.value)
                      }
                    >
                      <option value="">Choose one</option>
                      {field.options?.map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={values[field.key] ?? ""}
                      required={field.required}
                      placeholder={
                        field.type === "email"
                          ? "you@example.com"
                          : "Type here…"
                      }
                      onChange={(event) =>
                        onChange(field.key, event.target.value)
                      }
                    />
                  )}
                  {filledKeys.includes(field.key) && (
                    <b className="filled-by-mochi">✦ Mochi</b>
                  )}
                </label>
              ))}
            </div>

            <footer className="demo-form__footer">
              <p>
                By continuing, you confirm these details are accurate.
              </p>
              <button type="submit">
                {preset.submitLabel}
                <span aria-hidden="true">↗</span>
              </button>
            </footer>
          </>
        )}
      </form>
    </section>
  );
}

