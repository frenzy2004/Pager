export type SafeFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio";

export interface SafeField {
  key: string;
  label: string;
  type: SafeFieldType;
  required: boolean;
  options?: string[];
}

export interface SafeFieldEntry {
  field: SafeField;
  elements: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
}

const excludedAutocomplete = /^(?:current-password|new-password|one-time-code|cc-)/i;
const sensitiveLanguage =
  /password|passcode|one[\s_-]?time|\botp\b|credit[\s_-]?card|card[\s_-]?number|\bcvv\b|\bcvc\b|social[\s_-]?security|\bssn\b|routing[\s_-]?number|bank[\s_-]?account|\biban\b/i;

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function keyFor(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  index: number,
) {
  const source = element.name || element.id || `field-${index + 1}`;
  return (
    source
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || `field-${index + 1}`
  );
}

function explicitLabel(
  root: Document,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
) {
  if (!element.id) {
    return "";
  }

  return compact(
    Array.from(root.querySelectorAll<HTMLLabelElement>("label"))
      .find((label) => label.htmlFor === element.id)
      ?.textContent,
  );
}

function labelFor(
  root: Document,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  key: string,
) {
  if (element instanceof HTMLInputElement && element.type === "radio") {
    const legend = element
      .closest("fieldset")
      ?.querySelector<HTMLElement>("legend");
    if (compact(legend?.textContent)) {
      return compact(legend?.textContent);
    }
  }

  return (
    explicitLabel(root, element) ||
    compact(element.getAttribute("aria-label")) ||
    compact(element.closest("label")?.textContent) ||
    compact(element.getAttribute("placeholder")) ||
    key.replace(/[_-]+/g, " ")
  ).slice(0, 120);
}

function typeFor(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): SafeFieldType | null {
  if (element instanceof HTMLTextAreaElement) {
    return "textarea";
  }
  if (element instanceof HTMLSelectElement) {
    return "select";
  }

  const type = element.type.toLowerCase();
  if (type === "email" || type === "tel" || type === "url") {
    return type;
  }
  if (type === "checkbox" || type === "radio") {
    return type;
  }
  if (
    type === "text" ||
    type === "search" ||
    type === "number" ||
    type === "date" ||
    type === "month"
  ) {
    return "text";
  }
  return null;
}

function isSafeElement(
  root: Document,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  index: number,
) {
  if (
    element.disabled ||
    element.hasAttribute("readonly") ||
    element.closest("[hidden], [aria-hidden='true']") ||
    element.style.display === "none" ||
    element.style.visibility === "hidden"
  ) {
    return false;
  }

  if (element instanceof HTMLInputElement) {
    if (!typeFor(element)) {
      return false;
    }
    if (excludedAutocomplete.test(element.autocomplete)) {
      return false;
    }
  }

  const key = keyFor(element, index);
  return !sensitiveLanguage.test(
    [
      key,
      labelFor(root, element, key),
      element.getAttribute("autocomplete"),
    ].join(" "),
  );
}

export function discoverSafeFieldEntries(root: Document): SafeFieldEntry[] {
  const candidates = Array.from(
    root.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select"),
  );
  const groups = new Map<string, SafeFieldEntry>();

  candidates.forEach((element, index) => {
    if (!isSafeElement(root, element, index)) {
      return;
    }

    const type = typeFor(element);
    if (!type) {
      return;
    }

    const key = keyFor(element, index);
    const groupKey = type === "radio" ? `radio:${key}` : `field:${key}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.elements.push(element);
      existing.field.required ||= element.required;
      if (type === "radio" && element instanceof HTMLInputElement) {
        existing.field.options = [
          ...(existing.field.options ?? []),
          element.value,
        ];
      }
      return;
    }

    const options =
      type === "select" && element instanceof HTMLSelectElement
        ? Array.from(element.options)
            .filter((option) => option.value.length > 0)
            .map((option) => compact(option.textContent) || option.value)
        : type === "radio" && element instanceof HTMLInputElement
          ? [element.value]
          : undefined;

    groups.set(groupKey, {
      field: {
        key,
        label: labelFor(root, element, key),
        type,
        required: element.required,
        ...(options ? { options } : {}),
      },
      elements: [element],
    });
  });

  return Array.from(groups.values()).slice(0, 30);
}

export function discoverSafeFields(root: Document): SafeField[] {
  return discoverSafeFieldEntries(root).map(({ field }) => field);
}
