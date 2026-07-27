import {
  PageAgent,
  type ExecutionResult,
  type PageAgentConfig,
} from "page-agent";

import {
  buildPageAgentTask,
  PAGE_AGENT_SYSTEM_INSTRUCTIONS,
  strategyValues,
} from "../../../src/lib/mochi/page-agent-task";
import type {
  ExecutionMode,
  PageAgentFetchResponse,
  Strategy,
} from "../shared/protocol";
import {
  applyExactValues,
  readUndoEntryValue,
  resolveUndoEntryElement,
  snapshotSafeValues,
  undoExactValues,
  type UndoEntry,
} from "./exact-driver";
import {
  discoverSafeFieldEntries,
  isRenderedElement,
  type SafeFieldEntry,
} from "./fields";

const PAGE_AGENT_BASE_URL =
  "https://mochi-overlay.vercel.app/api/page-agent";

export interface AgentRuntime {
  sendMessage(
    message:
      | {
          type: "FETCH_PAGE_AGENT";
          body: string;
          executionId: string;
        }
      | {
          type: "RELEASE_EXECUTION_GUARD";
          executionId: string;
        }
      | {
          type: "AUTHORIZE_SUBMIT";
          executionId: string;
          documentId: string;
        },
  ): Promise<unknown>;
}

interface PageAgentLike {
  dispose(): void;
  execute(task: string): Promise<ExecutionResult>;
  stop(): Promise<void>;
}

export type PageAgentFactory = (config: PageAgentConfig) => PageAgentLike;

interface PageAgentExecutorOptions {
  createAgent?: PageAgentFactory;
  document: Document;
  isUserInitiatedEvent?: (event: Event) => boolean;
  runtime: AgentRuntime;
}

interface RuntimeEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function unwrapFetchResponse(value: unknown): PageAgentFetchResponse {
  let candidate = value;
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value
  ) {
    const envelope = value as RuntimeEnvelope;
    if (!envelope.ok) {
      throw new Error(envelope.error ?? "Page Agent proxy failed.");
    }
    candidate = envelope.result;
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("status" in candidate) ||
    !("bodyText" in candidate)
  ) {
    throw new Error("Page Agent proxy returned an invalid response.");
  }
  return candidate as PageAgentFetchResponse;
}

function unwrapSubmitAuthorization(value: unknown) {
  let candidate = value;
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value
  ) {
    const envelope = value as RuntimeEnvelope;
    if (!envelope.ok) {
      throw new Error(
        envelope.error ?? "Mochi could not authorize submission.",
      );
    }
    candidate = envelope.result;
  }
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "authorized" in candidate &&
    candidate.authorized === true
  );
}

function entryMatches(entry: SafeFieldEntry, expected: string) {
  if (entry.field.type === "radio") {
    return entry.elements.some(
      (element) =>
        element instanceof HTMLInputElement &&
        element.checked &&
        element.value === expected,
    );
  }
  const element = entry.elements[0];
  if (!element) return false;
  if (
    entry.field.type === "checkbox" &&
    element instanceof HTMLInputElement
  ) {
    const checked = /^(?:true|yes|1|on|checked)$/i.test(expected.trim());
    return element.checked === checked;
  }
  if (element instanceof HTMLSelectElement) {
    const selected = element.selectedOptions[0];
    return (
      element.value === expected || selected?.textContent?.trim() === expected
    );
  }
  return element.value === expected;
}

function inspectAgentValues(
  root: Document,
  values: Record<string, string>,
) {
  const entries = new Map(
    discoverSafeFieldEntries(root).map((entry) => [entry.field.key, entry]),
  );
  const matched: string[] = [];
  const mismatched: string[] = [];
  const missing: string[] = [];

  Object.entries(values).forEach(([key, value]) => {
    const entry = entries.get(key);
    if (!entry) {
      missing.push(key);
    } else if (entryMatches(entry, value)) {
      matched.push(key);
    } else {
      mismatched.push(key);
    }
  });
  return { entries, matched, mismatched, missing };
}

function changedFieldKeys(
  root: Document,
  before: UndoEntry[],
) {
  const changed = new Set<string>();
  before.forEach((entry) => {
    const current = readUndoEntryValue(root, entry);
    if (
      current &&
      `${current.value}\0${String(current.checked)}` !==
        `${entry.value}\0${String(entry.checked)}`
    ) {
      changed.add(entry.key);
    }
  });
  return changed;
}

function changedUndoEntries(root: Document, before: UndoEntry[]) {
  return before.flatMap((entry) => {
    const next = readUndoEntryValue(root, entry);
    if (
      !next ||
      `${next.value}\0${String(next.checked)}` ===
        `${entry.value}\0${String(entry.checked)}`
    ) {
      return [];
    }
    return [
      {
        ...entry,
        expectedValue: next.value,
        ...(typeof next.checked === "boolean"
          ? { expectedChecked: next.checked }
          : {}),
      },
    ];
  });
}

function rollbackAutomatedSnapshot(
  root: Document,
  before: UndoEntry[],
  userEditedValues: Map<
    Element,
    { value: string; checked?: boolean }
  > | null,
) {
  const guarded = before.flatMap((entry) => {
    const element = resolveUndoEntryElement(root, entry);
    const now = readUndoEntryValue(root, entry);
    if (!element || !now) return [];
    const userValue = userEditedValues?.get(element);
    const restoreValue = userValue?.value ?? entry.value;
    const restoreChecked =
      userValue?.checked ??
      entry.checked;
    if (
      `${now.value}\0${String(now.checked)}` ===
      `${restoreValue}\0${String(restoreChecked)}`
    ) {
      return [];
    }
    return [
      {
        ...entry,
        value: restoreValue,
        ...(typeof restoreChecked === "boolean"
          ? { checked: restoreChecked }
          : {}),
        expectedValue: now.value,
        ...(typeof now.checked === "boolean"
          ? { expectedChecked: now.checked }
          : {}),
      },
    ];
  });
  undoExactValues(root, guarded, true);
}

function installUserEditTracker(
  root: Document,
  isUserInitiatedEvent: (event: Event) => boolean,
) {
  const edited = new Map<
    Element,
    { value: string; checked?: boolean }
  >();
  const track = (event: Event) => {
    if (
      isUserInitiatedEvent(event) &&
      (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement)
    ) {
      edited.set(event.target, {
        value: event.target.value,
        ...(event.target instanceof HTMLInputElement &&
        (event.target.type === "checkbox" ||
          event.target.type === "radio")
          ? { checked: event.target.checked }
          : {}),
      });
    }
  };
  root.addEventListener("input", track, true);
  root.addEventListener("change", track, true);
  return {
    edited,
    dispose() {
      root.removeEventListener("input", track, true);
      root.removeEventListener("change", track, true);
    },
  };
}

const PAGE_AGENT_INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "[contenteditable]",
  "[role]",
  "[tabindex]",
  "[onclick]",
  "[data-action]",
].join(", ");

function collectInteractiveBlacklist(
  root: Document,
  safeElements: Set<Element>,
) {
  const blocked = new Set<Element>();

  function visit(container: Document | ShadowRoot, nested: boolean) {
    Array.from(container.querySelectorAll("*")).forEach((element) => {
      if (
        !safeElements.has(element) &&
        (nested || element.matches(PAGE_AGENT_INTERACTIVE_SELECTOR))
      ) {
        blocked.add(element);
      }
      if (element.shadowRoot) {
        visit(element.shadowRoot, true);
      }
      if (element instanceof HTMLIFrameElement) {
        try {
          if (element.contentDocument) {
            blocked.add(element);
            visit(element.contentDocument, true);
          }
        } catch {
          blocked.add(element);
        }
      }
    });
  }

  visit(root, false);
  return Array.from(blocked);
}

interface SubmissionGuard {
  dispose(): void;
  requestSubmitOnce(
    form: HTMLFormElement,
    submitter: HTMLButtonElement | HTMLInputElement,
  ): boolean;
}

function installSubmissionGuard(root: Document): SubmissionGuard {
  let allowSubmit = false;
  const view = root.defaultView;
  const prototype = view?.HTMLFormElement.prototype;
  const originalSubmit = prototype?.submit;
  const originalRequestSubmit = prototype?.requestSubmit;
  const blockedSubmit = function (this: HTMLFormElement) {
    if (allowSubmit) {
      return originalSubmit?.call(this);
    }
  };
  const blockedRequestSubmit = function (
    this: HTMLFormElement,
    submitter?: HTMLElement | null,
  ) {
    if (allowSubmit) {
      return originalRequestSubmit?.call(this, submitter);
    }
  };
  const blockEvent = (event: Event) => {
    if (!allowSubmit) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  root.addEventListener("submit", blockEvent, true);
  if (prototype && originalSubmit && originalRequestSubmit) {
    prototype.submit = blockedSubmit;
    prototype.requestSubmit = blockedRequestSubmit;
  }

  return {
    requestSubmitOnce(form, submitter) {
      if (!originalRequestSubmit) return false;
      let observed = false;
      form.addEventListener(
        "submit",
        () => {
          observed = true;
        },
        { capture: true, once: true },
      );
      allowSubmit = true;
      try {
        originalRequestSubmit.call(form, submitter);
      } finally {
        allowSubmit = false;
      }
      return observed;
    },
    dispose() {
      root.removeEventListener("submit", blockEvent, true);
      if (prototype?.submit === blockedSubmit && originalSubmit) {
        prototype.submit = originalSubmit;
      }
      if (
        prototype?.requestSubmit === blockedRequestSubmit &&
        originalRequestSubmit
      ) {
        prototype.requestSubmit = originalRequestSubmit;
      }
    },
  };
}

function isVisibleSubmitter(root: Document, element: Element) {
  if (!isRenderedElement(root, element)) return false;
  const view = root.defaultView;
  const documentRect = root.documentElement.getBoundingClientRect();
  if (
    !view ||
    documentRect.width <= 0 ||
    documentRect.height <= 0
  ) {
    return true;
  }
  const rect = element.getBoundingClientRect();
  return (
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < view.innerWidth &&
    rect.top < view.innerHeight
  );
}

function isActiveDocument(root: Document, documentId: string) {
  const currentDocumentId = root.defaultView?.__mochiDocumentId;
  return (
    root.visibilityState === "visible" &&
    (!currentDocumentId || currentDocumentId === documentId)
  );
}

function approvedSubmitter(form: HTMLFormElement) {
  if (form.method.toLowerCase() === "dialog") return null;
  const submitters = Array.from(form.elements).filter(
    (
      element,
    ): element is HTMLButtonElement | HTMLInputElement => {
      if (element instanceof HTMLButtonElement) {
        return (
          element.type === "submit" &&
          !element.disabled &&
          !element.closest("[hidden], [aria-hidden='true'], [inert]") &&
          isVisibleSubmitter(form.ownerDocument, element)
        );
      }
      return (
        element instanceof HTMLInputElement &&
        (element.type === "submit" || element.type === "image") &&
        !element.disabled &&
        !element.closest("[hidden], [aria-hidden='true'], [inert]") &&
        isVisibleSubmitter(form.ownerDocument, element)
      );
    },
  );
  if (submitters.length !== 1) return null;
  const submitter = submitters[0]!;
  if (
    ["formaction", "formmethod", "formenctype", "formtarget", "formnovalidate"]
      .some((attribute) => submitter.hasAttribute(attribute))
  ) {
    return null;
  }
  const intent = [
    submitter.getAttribute("aria-label"),
    submitter.getAttribute("title"),
    submitter instanceof HTMLInputElement
      ? submitter.value
      : submitter.textContent,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    /\b(delete|remove|withdraw|cancel|pay|purchase|charge|transfer|order)\b/i.test(
      intent,
    )
  ) {
    return null;
  }
  return submitter;
}

function submitMatchedFormOnce(
  root: Document,
  inspection: ReturnType<typeof inspectAgentValues>,
  guard: SubmissionGuard,
) {
  const forms = new Set<HTMLFormElement>();
  inspection.matched.forEach((key) => {
    inspection.entries.get(key)?.elements.forEach((element) => {
      if (element.form) forms.add(element.form);
    });
  });
  if (forms.size !== 1) {
    return false;
  }

  const form = Array.from(forms)[0]!;
  const submitter = approvedSubmitter(form);
  return submitter ? guard.requestSubmitOnce(form, submitter) : false;
}

export function createPageAgentExecutor({
  createAgent = (config) => new PageAgent(config),
  document: pageDocument,
  isUserInitiatedEvent = (event) => event.isTrusted,
  runtime,
}: PageAgentExecutorOptions) {
  let activeAgent: PageAgentLike | null = null;
  let undoSnapshot: UndoEntry[] = [];
  let activeUserEdits: Map<
    Element,
    { value: string; checked?: boolean }
  > | null = null;
  let cancelRequested = false;
  let currentExecutionId: string | null = null;

  function restoreAutomatedSnapshot() {
    rollbackAutomatedSnapshot(
      pageDocument,
      undoSnapshot,
      activeUserEdits,
    );
    undoSnapshot = [];
  }

  const customFetch: typeof fetch = async (_input, init) => {
    if (typeof init?.body !== "string") {
      throw new Error("Page Agent sent an unsupported request body.");
    }
    if (!currentExecutionId) {
      throw new Error("Page Agent execution is no longer active.");
    }
    const proxy = unwrapFetchResponse(
      await runtime.sendMessage({
        type: "FETCH_PAGE_AGENT",
        body: init.body,
        executionId: currentExecutionId,
      }),
    );
    return new Response(proxy.bodyText, {
      status: proxy.status,
      statusText: proxy.statusText,
      headers: proxy.headers,
    });
  };

  return {
    async run(
      strategy: Strategy,
      mode: ExecutionMode,
      executionId = "local-test-execution",
      documentId = "local-test-document",
    ) {
      const values = strategyValues(strategy);
      if (mode === "review") {
        return {
          status: "preview" as const,
          adapter: "page-agent" as const,
          values,
          changedFields: 0,
        };
      }

      activeAgent?.dispose();
      cancelRequested = false;
      currentExecutionId = executionId;
      undoSnapshot = snapshotSafeValues(pageDocument);
      const userEditTracker = installUserEditTracker(
        pageDocument,
        isUserInitiatedEvent,
      );
      activeUserEdits = userEditTracker.edited;
      const submissionGuard = installSubmissionGuard(pageDocument);
      const safeElements = new Set<Element>(
        discoverSafeFieldEntries(pageDocument).flatMap(
          ({ elements }) => elements,
        ),
      );
      const interactiveBlacklist = collectInteractiveBlacklist(
        pageDocument,
        safeElements,
      );
      const agent = createAgent({
        apiKey: "",
        baseURL: PAGE_AGENT_BASE_URL,
        model: "gpt-5.6-sol",
        language: "en-US",
        maxSteps: 16,
        interactiveBlacklist,
        enableMask: true,
        promptForNextTask: false,
        customFetch,
        customTools: {
          ask_user: null,
          click_element_by_index: null,
        },
        experimentalScriptExecutionTool: false,
        instructions: {
          system: PAGE_AGENT_SYSTEM_INSTRUCTIONS,
        },
      });
      activeAgent = agent;
      try {
        const result = await agent.execute(buildPageAgentTask(strategy, mode));
        if (cancelRequested) {
          restoreAutomatedSnapshot();
          return {
            status: "cancelled" as const,
            adapter: "page-agent" as const,
            values: {},
            changedFields: 0,
          };
        }
        if (!result.success) {
          throw new Error(result.data || "Page Agent could not finish.");
        }
        const inspection = inspectAgentValues(pageDocument, values);
        if (inspection.mismatched.length > 0) {
          throw new Error(
            `Page Agent did not safely fill: ${inspection.mismatched.join(", ")}.`,
          );
        }
        if (Object.keys(values).length > 0 && inspection.matched.length === 0) {
          throw new Error("Page Agent could not match any safe target fields.");
        }
        const changedKeys = changedFieldKeys(
          pageDocument,
          undoSnapshot,
        );
        const changedEntries = changedUndoEntries(
          pageDocument,
          undoSnapshot,
        );
        const unexpected = Array.from(changedKeys).filter(
          (key) => !(key in values),
        );
        if (unexpected.length > 0) {
          throw new Error(
            `Page Agent changed fields outside the approved field map: ${unexpected.join(", ")}.`,
          );
        }
        const changedFields = inspection.matched.filter((key) =>
          changedKeys.has(key),
        ).length;
        undoSnapshot = changedEntries;
        const completeForSubmission =
          inspection.missing.length === 0 &&
          inspection.matched.length === Object.keys(values).length;
        let submitted = false;
        if (
          mode === "autopilot" &&
          completeForSubmission &&
          !cancelRequested &&
          currentExecutionId === executionId &&
          isActiveDocument(pageDocument, documentId)
        ) {
          const authorized = unwrapSubmitAuthorization(
            await runtime.sendMessage({
              type: "AUTHORIZE_SUBMIT",
              executionId,
              documentId,
            }),
          );
          if (cancelRequested) {
            restoreAutomatedSnapshot();
            return {
              status: "cancelled" as const,
              adapter: "page-agent" as const,
              values: {},
              changedFields: 0,
            };
          }
          if (
            authorized &&
            currentExecutionId === executionId &&
            isActiveDocument(pageDocument, documentId)
          ) {
            submitted = submitMatchedFormOnce(
              pageDocument,
              inspection,
              submissionGuard,
            );
          }
        }
        return {
          status:
            mode === "autopilot" && submitted
              ? ("submitted" as const)
              : ("filled" as const),
          adapter: "page-agent" as const,
          values,
          changedFields,
          ...((mode === "autopilot" && !submitted) ||
          (mode === "fill" && inspection.missing.length > 0)
            ? {
                warning:
                  inspection.missing.length > 0
                    ? `Mochi skipped unavailable fields: ${inspection.missing.join(", ")}. It did not submit.`
                    : "Mochi filled the safe fields but did not find one valid form submission boundary.",
              }
            : {}),
        };
      } catch (error) {
        restoreAutomatedSnapshot();
        if (cancelRequested) {
          return {
            status: "cancelled" as const,
            adapter: "page-agent" as const,
            values: {},
            changedFields: 0,
          };
        }
        throw error;
      } finally {
        userEditTracker.dispose();
        submissionGuard.dispose();
        await runtime
          .sendMessage({
            type: "RELEASE_EXECUTION_GUARD",
            executionId,
          })
          .catch(() => undefined);
        if (currentExecutionId === executionId) {
          currentExecutionId = null;
          activeUserEdits = null;
        }
      }
    },
    async runExact(
      strategy: Strategy,
      executionId = "local-test-execution",
    ) {
      activeAgent?.dispose();
      activeAgent = null;
      cancelRequested = false;
      currentExecutionId = executionId;
      undoSnapshot = snapshotSafeValues(pageDocument);
      const userEditTracker = installUserEditTracker(
        pageDocument,
        isUserInitiatedEvent,
      );
      activeUserEdits = userEditTracker.edited;
      const submissionGuard = installSubmissionGuard(pageDocument);
      let guardReleased = false;
      try {
        const values = strategyValues(strategy);
        const fallback = applyExactValues(pageDocument, values);
        if (fallback.changed.length === 0 && fallback.skipped.length > 0) {
          restoreAutomatedSnapshot();
          throw new Error("Mochi could not match the safe field map.");
        }
        const changedEntries = changedUndoEntries(
          pageDocument,
          undoSnapshot,
        );
        const unexpected = Array.from(
          new Set(changedEntries.map(({ key }) => key)),
        ).filter((key) => !(key in values));
        if (unexpected.length > 0) {
          throw new Error(
            `Exact fill changed fields outside the approved field map: ${unexpected.join(", ")}.`,
          );
        }
        undoSnapshot = changedEntries;
        await runtime
          .sendMessage({
            type: "RELEASE_EXECUTION_GUARD",
            executionId,
          })
          .catch(() => undefined);
        guardReleased = true;
        if (
          cancelRequested ||
          currentExecutionId !== executionId
        ) {
          restoreAutomatedSnapshot();
          return {
            status: "cancelled" as const,
            adapter: "exact-fallback" as const,
            values: {},
            changedFields: 0,
          };
        }
        return {
          status: "filled" as const,
          adapter: "exact-fallback" as const,
          values,
          changedFields: new Set(
            fallback.changed.map(({ key }) => key),
          ).size,
          warning:
            "You approved Mochi's safe exact-map fallback. It filled matched fields and did not submit.",
        };
      } catch (error) {
        restoreAutomatedSnapshot();
        if (cancelRequested) {
          return {
            status: "cancelled" as const,
            adapter: "exact-fallback" as const,
            values: {},
            changedFields: 0,
          };
        }
        throw error;
      } finally {
        userEditTracker.dispose();
        submissionGuard.dispose();
        if (!guardReleased) {
          await runtime
            .sendMessage({
              type: "RELEASE_EXECUTION_GUARD",
              executionId,
            })
            .catch(() => undefined);
        }
        if (currentExecutionId === executionId) {
          currentExecutionId = null;
          activeUserEdits = null;
        }
      }
    },
    async cancel() {
      cancelRequested = true;
      const snapshot = [...undoSnapshot];
      const userEdits = activeUserEdits;
      rollbackAutomatedSnapshot(pageDocument, snapshot, userEdits);
      if (activeAgent) {
        await activeAgent.stop();
      }
      rollbackAutomatedSnapshot(pageDocument, snapshot, userEdits);
      undoSnapshot = [];
    },
    undo() {
      const submissionGuard = installSubmissionGuard(pageDocument);
      try {
        undoExactValues(pageDocument, undoSnapshot, true);
        undoSnapshot = [];
      } finally {
        submissionGuard.dispose();
      }
    },
  };
}

declare global {
  interface Window {
    __mochiDocumentId?: string;
    __mochiPageAgentInstalled?: boolean;
  }
}

if (
  typeof chrome !== "undefined" &&
  chrome.runtime?.id &&
  !window.__mochiPageAgentInstalled
) {
  window.__mochiPageAgentInstalled = true;
  const executor = createPageAgentExecutor({
    document,
    runtime: {
      sendMessage(message) {
        return chrome.runtime.sendMessage(message);
      },
    },
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    ) {
      return;
    }
    if (
      message.type === "RUN_PAGE_AGENT" &&
      "strategy" in message &&
      "mode" in message &&
      "executionId" in message &&
      typeof message.executionId === "string" &&
      "documentId" in message &&
      typeof message.documentId === "string"
    ) {
      if (window.__mochiDocumentId !== message.documentId) {
        sendResponse({
          error: "The form document changed before Page Agent started.",
        });
        return;
      }
      void executor
        .run(
          message.strategy as Strategy,
          message.mode as ExecutionMode,
          message.executionId,
          message.documentId,
        )
        .then(
          (result) => sendResponse(result),
          (error: unknown) =>
            sendResponse({
              error:
                error instanceof Error
                  ? error.message
                  : "Page Agent could not finish.",
            }),
        );
      return true;
    }
    if (
      message.type === "RUN_EXACT_FALLBACK" &&
      "strategy" in message &&
      "executionId" in message &&
      typeof message.executionId === "string" &&
      "documentId" in message &&
      typeof message.documentId === "string"
    ) {
      if (window.__mochiDocumentId !== message.documentId) {
        sendResponse({
          error: "The form document changed before exact fill started.",
        });
        return;
      }
      void executor.runExact(
        message.strategy as Strategy,
        message.executionId,
      ).then(
        (result) => sendResponse(result),
        (error: unknown) =>
          sendResponse({
            error:
              error instanceof Error
                ? error.message
                : "Mochi could not use the exact fallback.",
          }),
      );
      return true;
    }
    if (message.type === "CANCEL_EXECUTION") {
      void executor.cancel().then(
        () => sendResponse({ status: "cancelled" }),
        (error: unknown) =>
          sendResponse({
            error:
              error instanceof Error
                ? error.message
                : "Mochi could not cancel Page Agent.",
          }),
      );
      return true;
    }
    if (
      message.type === "RUN_UNDO" &&
      "documentId" in message &&
      typeof message.documentId === "string"
    ) {
      if (window.__mochiDocumentId !== message.documentId) {
        sendResponse({
          error: "The form document changed before Undo.",
        });
        return;
      }
      executor.undo();
      sendResponse({ status: "undone" });
    }
  });
}
