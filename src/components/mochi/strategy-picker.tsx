import type { PageField, Strategy } from "@/lib/mochi/types";

interface StrategyPickerProps {
  strategies: [Strategy, Strategy, Strategy];
  selectedId: Strategy["id"];
  fields: PageField[];
  onSelect(id: Strategy["id"]): void;
}

const statusLabels = {
  supported: "from context",
  researched: "researched",
  draft: "draft",
  "needs-input": "needs you",
} as const;

export function StrategyPicker({
  strategies,
  selectedId,
  fields,
  onSelect,
}: StrategyPickerProps) {
  const selected =
    strategies.find((strategy) => strategy.id === selectedId) ?? strategies[1];

  return (
    <>
      <div
        className="strategy-grid"
        role="group"
        aria-label="Three best strategies"
      >
        {strategies.map((strategy) => (
          <button
            key={strategy.id}
            type="button"
            data-testid="strategy-card"
            className={`strategy-card strategy-card--${strategy.accent}${
              selected.id === strategy.id ? " is-selected" : ""
            }`}
            aria-pressed={selected.id === strategy.id}
            aria-label={`${strategy.label}: ${strategy.rationale}`}
            onClick={() => onSelect(strategy.id)}
          >
            <span className="strategy-card__topline">
              <span>{strategy.eyebrow}</span>
              <strong>{Math.round(strategy.confidence * 100)}%</strong>
            </span>
            <b>{strategy.label}</b>
            <small>{strategy.rationale}</small>
          </button>
        ))}
      </div>

      <div className="field-preview">
        <div className="field-preview__header">
          <span>Proposed page changes</span>
          <span>{selected.label}</span>
        </div>
        {fields.map((field) => {
          const suggestion = selected.fields[field.key];
          if (!suggestion) return null;
          return (
            <div className="field-preview__row" key={field.key}>
              <div>
                <strong>{field.label}</strong>
                <span
                  className={`status-pill status-pill--${suggestion.status}`}
                >
                  {statusLabels[suggestion.status]}
                </span>
              </div>
              <p>
                {suggestion.value ||
                  "Mochi will leave this blank instead of guessing."}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}
