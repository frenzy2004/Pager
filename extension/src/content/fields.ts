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
const MAX_DISCOVERY_CANDIDATES = 300;
const MAX_FIELDS = 30;
const MAX_OPTIONS = 30;

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function boundedOption(value: string | null | undefined) {
  return compact(value).slice(0, 120);
}

function appendOption(options: string[], value: string | null | undefined) {
  const bounded = boundedOption(value);
  if (
    bounded &&
    options.length < MAX_OPTIONS &&
    !options.includes(bounded)
  ) {
    options.push(bounded);
  }
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

export function isRenderedElement(
  root: Document,
  element: Element,
) {
  const view = root.defaultView;
  if (!view) return true;

  let ancestor: Element | null = element;
  while (ancestor) {
    const style = view.getComputedStyle(ancestor);
    const opacity = Number.parseFloat(style.opacity);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      (!Number.isNaN(opacity) && opacity <= 0.01) ||
      style.getPropertyValue("content-visibility") === "hidden"
    ) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }

  const documentRect = root.documentElement.getBoundingClientRect();
  if (documentRect.width > 0 && documentRect.height > 0) {
    const rect = element.getBoundingClientRect();
    const documentTop = rect.top + view.scrollY;
    const documentBottom = rect.bottom + view.scrollY;
    const documentHeight = Math.max(
      root.documentElement.scrollHeight,
      root.body?.scrollHeight ?? 0,
      documentRect.height,
      view.innerHeight,
    );
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.right <= 0 ||
      rect.left >= view.innerWidth ||
      documentBottom <= 0 ||
      documentTop >= documentHeight
    ) {
      return false;
    }
  }
  return true;
}

function isSafeElement(
  root: Document,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  index: number,
) {
  if (
    element.disabled ||
    element.hasAttribute("readonly") ||
    element.closest("[hidden], [aria-hidden='true'], [inert]") ||
    !isRenderedElement(root, element)
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
  const candidates = root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");
  const groups = new Map<string, SafeFieldEntry>();

  for (
    let index = 0;
    index < candidates.length &&
    index < MAX_DISCOVERY_CANDIDATES &&
    groups.size < MAX_FIELDS;
    index += 1
  ) {
    const element = candidates[index]!;
    if (!isSafeElement(root, element, index)) {
      continue;
    }

    const type = typeFor(element);
    if (!type) {
      continue;
    }

    const key = keyFor(element, index);
    const groupKey = type === "radio" ? `radio:${key}` : `field:${key}`;
    const existing = groups.get(groupKey);
    if (existing) {
      if (existing.elements.length >= MAX_OPTIONS) {
        continue;
      }
      existing.elements.push(element);
      existing.field.required ||= element.required;
      if (type === "radio" && element instanceof HTMLInputElement) {
        const options = existing.field.options ?? [];
        appendOption(options, element.value);
        existing.field.options = options;
      }
      continue;
    }

    let options: string[] | undefined;
    if (type === "select" && element instanceof HTMLSelectElement) {
      options = [];
      for (
        let optionIndex = 0;
        optionIndex < element.options.length &&
        options.length < MAX_OPTIONS;
        optionIndex += 1
      ) {
        const option = element.options[optionIndex]!;
        if (option.value.length > 0) {
          appendOption(options, option.textContent || option.value);
        }
      }
    } else if (type === "radio" && element instanceof HTMLInputElement) {
      options = [];
      appendOption(options, element.value);
    }

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
  }

  return Array.from(groups.values());
}

export function discoverSafeFields(root: Document): SafeField[] {
  return discoverSafeFieldEntries(root).map(({ field }) => field);
}
