import type { ExecutionMode } from "@/lib/mochi/types";

const modes: {
  id: ExecutionMode;
  label: string;
  detail: string;
}[] = [
  { id: "review", label: "Review", detail: "ask first" },
  { id: "fill", label: "Fill only", detail: "never submit" },
  { id: "autopilot", label: "Autopilot", detail: "fill + send" },
];

interface ModeSwitcherProps {
  value: ExecutionMode;
  onChange(mode: ExecutionMode): void;
}

export function ModeSwitcher({ value, onChange }: ModeSwitcherProps) {
  return (
    <fieldset className="mode-switcher">
      <legend>How brave should Mochi be?</legend>
      <div>
        {modes.map((mode) => (
          <label
            key={mode.id}
            className={value === mode.id ? "is-selected" : ""}
          >
            <input
              type="radio"
              name="execution-mode"
              value={mode.id}
              checked={value === mode.id}
              onChange={() => onChange(mode.id)}
            />
            <span>
              <strong>{mode.label}</strong>
              <small>{mode.detail}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

