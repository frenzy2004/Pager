import { discoverSafeFieldEntries } from "./fields";

type SafeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface UndoEntry {
  key: string;
  ordinal: number;
  value: string;
  checked?: boolean;
}

export interface ExactFillResult {
  changed: UndoEntry[];
  skipped: string[];
}

function dispatchControlEvents(element: SafeControl) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeValue(element: SafeControl, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
}

function setNativeChecked(element: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "checked",
  )?.set;
  setter?.call(element, checked);
}

function booleanValue(value: string | boolean) {
  return (
    value === true ||
    (typeof value === "string" &&
      /^(?:true|yes|1|on|checked)$/i.test(value.trim()))
  );
}

export function applyExactValues(
  root: Document,
  values: Record<string, string | boolean>,
): ExactFillResult {
  const entries = new Map(
    discoverSafeFieldEntries(root).map((entry) => [entry.field.key, entry]),
  );
  const changed: UndoEntry[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const entry = entries.get(key);
    if (!entry) {
      skipped.push(key);
      continue;
    }

    if (entry.field.type === "radio") {
      const desired = String(value);
      let matched = false;
      entry.elements.forEach((element, ordinal) => {
        if (!(element instanceof HTMLInputElement)) {
          return;
        }
        const next = element.value === desired;
        matched ||= next;
        if (element.checked !== next) {
          changed.push({
            key,
            ordinal,
            value: element.value,
            checked: element.checked,
          });
          setNativeChecked(element, next);
          dispatchControlEvents(element);
        }
      });
      if (!matched) {
        skipped.push(key);
      }
      continue;
    }

    const element = entry.elements[0];
    if (!element) {
      skipped.push(key);
      continue;
    }

    if (
      entry.field.type === "checkbox" &&
      element instanceof HTMLInputElement
    ) {
      const next = booleanValue(value);
      if (element.checked !== next) {
        changed.push({
          key,
          ordinal: 0,
          value: element.value,
          checked: element.checked,
        });
        setNativeChecked(element, next);
        dispatchControlEvents(element);
      }
      continue;
    }

    const next = String(value);
    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find(
        ({ value: optionValue, textContent }) =>
          optionValue === next || textContent?.trim() === next,
      );
      if (!option) {
        skipped.push(key);
        continue;
      }
      if (element.value !== option.value) {
        changed.push({ key, ordinal: 0, value: element.value });
        setNativeValue(element, option.value);
        dispatchControlEvents(element);
      }
      continue;
    }

    if (element.value !== next) {
      changed.push({ key, ordinal: 0, value: element.value });
      setNativeValue(element, next);
      dispatchControlEvents(element);
    }
  }

  return { changed, skipped };
}

export function undoExactValues(root: Document, changed: UndoEntry[]) {
  const entries = new Map(
    discoverSafeFieldEntries(root).map((entry) => [entry.field.key, entry]),
  );

  for (const undo of [...changed].reverse()) {
    const element = entries.get(undo.key)?.elements[undo.ordinal];
    if (!element) {
      continue;
    }

    if (
      typeof undo.checked === "boolean" &&
      element instanceof HTMLInputElement
    ) {
      setNativeChecked(element, undo.checked);
    } else {
      setNativeValue(element, undo.value);
    }
    dispatchControlEvents(element);
  }
}
