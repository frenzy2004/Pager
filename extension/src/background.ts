import { createChromeAdapter, type ActiveTab, type ChromeAdapter } from "./shared/chrome";
import { normalizeCapturedImage } from "./shared/image-policy";
import { solveProofOfWork } from "./shared/proof-of-work";
import type {
  AnalysisTarget,
  ConnectorMessage,
  ConnectorSession,
  ExecutionSummary,
  PageAgentFetchResponse,
  Strategy,
} from "./shared/protocol";
import {
  createEmptySession,
  MAX_CAPTURES,
  parseConnectorMessage,
  reduceSession,
} from "./shared/session";

export const MOCHI_ORIGIN = "https://mochi-overlay.vercel.app";
export const ANALYZE_URL = `${MOCHI_ORIGIN}/api/analyze`;
export const CONNECTOR_SESSION_URL = `${MOCHI_ORIGIN}/api/connector/session`;
export const PAGE_AGENT_URL = `${MOCHI_ORIGIN}/api/page-agent/chat/completions`;
export const MOCHI_EXTENSION_ID = "fljecmlbnknpeehjcffenmjjnenmkjea";
const CAPTURE_INTERVAL_MS = 550;
const EXECUTION_CONTEXT_MUTATIONS = new Set<ConnectorMessage["type"]>([
  "CAPTURE_VIEWPORT",
  "START_SNIP",
  "REMOVE_CAPTURE",
  "CLEAR_SESSION",
  "SET_PRESET",
  "SET_TASK_HINT",
  "SELECT_STRATEGY",
  "SET_MODE",
  "ANALYZE",
  "UNDO",
]);

interface CoordinatorDependencies {
  chrome: ChromeAdapter;
  delay(milliseconds: number): Promise<void>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  normalizeImage(dataUrl: string): Promise<string>;
  solveChallenge?: (
    challengeToken: string,
    difficulty: number,
  ) => Promise<string>;
  extensionId?: string;
  now?: () => Date;
  randomId?: () => string;
}

function isEligibleTab(tab: ActiveTab | null): tab is ActiveTab {
  return Boolean(tab && /^https?:\/\//.test(tab.url));
}

function isStrategy(value: unknown): value is Strategy {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const strategy = value as Partial<Strategy>;
  return (
    (strategy.id === "safe" ||
      strategy.id === "balanced" ||
      strategy.id === "standout") &&
    typeof strategy.label === "string" &&
    typeof strategy.rationale === "string" &&
    typeof strategy.fields === "object" &&
    strategy.fields !== null
  );
}

interface FieldManifest {
  documentId: string;
  fields: unknown[];
}

function isFieldManifest(value: unknown): value is FieldManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<FieldManifest>;
  const fieldTypes = new Set([
    "text",
    "email",
    "tel",
    "url",
    "textarea",
    "select",
    "checkbox",
    "radio",
  ]);
  return (
    typeof manifest.documentId === "string" &&
    /^[A-Za-z0-9_-]{8,120}$/.test(manifest.documentId) &&
    Array.isArray(manifest.fields) &&
    manifest.fields.length > 0 &&
    manifest.fields.length <= 30 &&
    JSON.stringify(manifest.fields).length <= 100_000 &&
    manifest.fields.every((value) => {
      if (typeof value !== "object" || value === null) return false;
      const field = value as Record<string, unknown>;
      return (
        typeof field.key === "string" &&
        /^[A-Za-z0-9_-]{1,80}$/.test(field.key) &&
        typeof field.label === "string" &&
        field.label.length >= 1 &&
        field.label.length <= 120 &&
        typeof field.type === "string" &&
        fieldTypes.has(field.type) &&
        typeof field.required === "boolean" &&
        (field.options === undefined ||
          (Array.isArray(field.options) &&
            field.options.length <= 30 &&
            field.options.every(
              (option) =>
                typeof option === "string" &&
                option.length >= 1 &&
                option.length <= 120,
            )))
      );
    })
  );
}

function fieldManifestKey(fields: unknown[]) {
  return JSON.stringify(fields);
}

function captureSourceMetadata(tab: ActiveTab) {
  const parsed = new URL(tab.url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Mochi cannot capture metadata from this page.");
  }
  parsed.username = "";
  parsed.password = "";
  let sourceUrl = parsed.href;
  if (sourceUrl.length > 2_048) {
    parsed.search = "";
    parsed.hash = "";
    sourceUrl = parsed.href;
  }
  if (sourceUrl.length > 2_048) {
    sourceUrl = new URL("/", parsed.origin).href;
  }
  if (sourceUrl.length > 2_048) {
    throw new Error("This page URL is too large to save as capture context.");
  }
  return {
    sourceUrl,
    sourceTitle: tab.title.slice(0, 300),
  };
}

export function createBackgroundCoordinator({
  chrome: chromeAdapter,
  delay,
  fetch: fetchFromVercel,
  normalizeImage,
  solveChallenge = solveProofOfWork,
  extensionId = MOCHI_EXTENSION_ID,
  now = () => new Date(),
  randomId = () => crypto.randomUUID(),
}: CoordinatorDependencies) {
  let cancelRequested = false;
  let cancelConfirmed = false;
  let executionTarget: ActiveTab | null = null;
  let activeExecutionId: string | null = null;
  let installId: string | null = null;
  let connectorToken: { value: string; expiresAt: number } | null = null;
  let captureRateQueue: Promise<void> = Promise.resolve();
  let captureOperationQueue: Promise<void> = Promise.resolve();
  let sessionWriteQueue: Promise<void> = Promise.resolve();
  let analysisInFlight = false;
  let contextGeneration = 0;
  let executionContextGeneration = 0;
  let executionOperationClaimed = false;
  let executionContextMutations = 0;
  let activeExecutionOperation: Promise<unknown> | null = null;
  let clearOperationClaimed = false;
  let nextCaptureAt = 0;

  async function loadSession(): Promise<ConnectorSession> {
    return (await chromeAdapter.getSession()) ?? createEmptySession();
  }

  function queueSessionWrite<T>(operation: () => Promise<T>) {
    const pending = sessionWriteQueue.then(operation);
    sessionWriteQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  function saveSession(session: ConnectorSession) {
    return queueSessionWrite(async () => {
      await chromeAdapter.setSession(session);
      await chromeAdapter.broadcast({ type: "SESSION_UPDATED", session });
      return session;
    });
  }

  function saveCaptureSession(
    session: ConnectorSession,
    requestedGeneration: number,
  ) {
    return queueSessionWrite(async () => {
      if (requestedGeneration !== contextGeneration) {
        return (await chromeAdapter.getSession()) ?? createEmptySession();
      }
      await chromeAdapter.setSession(session);
      await chromeAdapter.broadcast({ type: "SESSION_UPDATED", session });
      return session;
    });
  }

  async function getInstallId() {
    if (installId) return installId;
    const stored = await chromeAdapter.getInstallId();
    if (stored && /^[A-Za-z0-9_-]{8,120}$/.test(stored)) {
      installId = stored;
      return stored;
    }
    const generated = randomId();
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(generated)) {
      throw new Error("Mochi could not create a stable connector identity.");
    }
    await chromeAdapter.setInstallId(generated);
    installId = generated;
    return generated;
  }

  async function activeTab() {
    const tab = await chromeAdapter.queryActiveTab();
    if (!isEligibleTab(tab)) {
      throw new Error(
        "Mochi works on normal HTTP and HTTPS pages. This tab is restricted.",
      );
    }
    return tab;
  }

  async function assertActiveTarget(target: ActiveTab) {
    const current = await activeTab();
    if (
      current.id !== target.id ||
      current.windowId !== target.windowId ||
      current.url !== target.url
    ) {
      throw new Error(
        "The active tab changed during execution. Mochi stopped before touching the other page.",
      );
    }
    return current;
  }

  async function discoverFieldManifest(tabId: number) {
    const manifest = await chromeAdapter.sendTabMessage(tabId, {
      type: "DISCOVER_FIELDS",
    });
    if (!isFieldManifest(manifest)) {
      throw new Error("Mochi could not find safe form fields on this page.");
    }
    return manifest;
  }

  async function assertDocumentTarget(
    target: AnalysisTarget | null,
    tab: ActiveTab,
  ) {
    if (
      !target ||
      tab.id !== target.tabId ||
      tab.windowId !== target.windowId ||
      tab.url !== target.tabUrl
    ) {
      throw new Error(
        "Return to the exact form Mochi analyzed, or analyze this form again.",
      );
    }
    const manifest = await discoverFieldManifest(tab.id);
    if (
      manifest.documentId !== target.documentId ||
      fieldManifestKey(manifest.fields) !== target.fieldManifestKey
    ) {
      throw new Error(
        "This form changed after analysis. Capture and analyze it again before filling.",
      );
    }
    return target;
  }

  async function assertAnalyzedTarget(
    session: ConnectorSession,
    tab: ActiveTab,
  ) {
    return assertDocumentTarget(session.analysisTarget, tab);
  }

  async function fail(error: unknown) {
    const message =
      error instanceof Error ? error.message : "Mochi could not finish.";
    await saveSession(
      reduceSession(await loadSession(), { type: "failed", error: message }),
    );
    return message;
  }

  async function captureActiveFrameNow(tab: ActiveTab) {
    try {
      await chromeAdapter.sendTabMessage(tab.id, { type: "HIDE_PET" });
      await delay(80);
      const currentTab = await activeTab();
      if (
        currentTab.id !== tab.id ||
        currentTab.windowId !== tab.windowId ||
        currentTab.url !== tab.url
      ) {
        throw new Error(
          "The active tab changed before Mochi could capture it. Try again on the page you want.",
        );
      }
      const captured = await chromeAdapter.captureVisibleTab(tab.windowId);
      const afterCapture = await activeTab();
      if (
        afterCapture.id !== tab.id ||
        afterCapture.windowId !== tab.windowId ||
        afterCapture.url !== tab.url
      ) {
        throw new Error(
          "The active tab changed while Mochi captured. The captured image was discarded.",
        );
      }
      return captured;
    } finally {
      await chromeAdapter
        .sendTabMessage(tab.id, { type: "SHOW_PET" })
        .catch(() => undefined);
    }
  }

  function captureActiveFrame(tab: ActiveTab) {
    const capture = captureRateQueue.then(async () => {
      const currentTime = now().getTime();
      const scheduledTime = Math.max(currentTime, nextCaptureAt);
      const waitTime = scheduledTime - currentTime;
      if (waitTime > 0) {
        await delay(waitTime);
      }
      nextCaptureAt = scheduledTime + CAPTURE_INTERVAL_MS;
      return captureActiveFrameNow(tab);
    });
    captureRateQueue = capture.then(
      () => undefined,
      () => undefined,
    );
    return capture;
  }

  function queueCaptureOperation<T>(operation: () => Promise<T>) {
    const pending = captureOperationQueue.then(operation);
    captureOperationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  function assertCaptureCapacity(current: ConnectorSession) {
    if (current.captures.length >= MAX_CAPTURES) {
      throw new Error(
        `Mochi already has ${MAX_CAPTURES} captures. Remove one before adding another.`,
      );
    }
  }

  function captureViewport(requestedGeneration: number) {
    return queueCaptureOperation(async () => {
      if (requestedGeneration !== contextGeneration) {
        return loadSession();
      }
      const tab = await activeTab();
      const source = captureSourceMetadata(tab);
      const current = await loadSession();
      assertCaptureCapacity(current);
      const operationId = randomId();
      if (requestedGeneration !== contextGeneration) {
        return loadSession();
      }
      await saveCaptureSession(
        {
          ...current,
          captureLease: {
            operationId,
            tabId: tab.id,
            kind: "viewport",
          },
          error: null,
          status: "capturing",
        },
        requestedGeneration,
      );
      if (requestedGeneration !== contextGeneration) {
        return loadSession();
      }

      try {
        const rawCapture = await captureActiveFrame(tab);
        const dataUrl = await normalizeImage(rawCapture);
        if (requestedGeneration !== contextGeneration) {
          return loadSession();
        }
        await assertActiveTarget(tab);
        const latest = await loadSession();
        if (latest.captureLease?.operationId !== operationId) {
          return latest;
        }
        assertCaptureCapacity(latest);
        return saveCaptureSession(
          reduceSession(latest, {
            type: "capture-added",
            capture: {
              id: randomId(),
              dataUrl,
              ...source,
              capturedAt: now().toISOString(),
              kind: "viewport",
            },
          }),
          requestedGeneration,
        );
      } catch (error) {
        if (requestedGeneration !== contextGeneration) {
          return loadSession();
        }
        const message =
          error instanceof Error ? error.message : "Mochi could not finish.";
        await saveCaptureSession(
          reduceSession(await loadSession(), {
            type: "failed",
            error: message,
          }),
          requestedGeneration,
        );
        throw error;
      }
    });
  }

  function captureRegion(requestedGeneration: number) {
    return queueCaptureOperation(async () => {
      if (requestedGeneration !== contextGeneration) {
        return loadSession();
      }
      const tab = await activeTab();
      const source = captureSourceMetadata(tab);
      const current = await loadSession();
      assertCaptureCapacity(current);
      const operationId = randomId();
      if (requestedGeneration !== contextGeneration) {
        return loadSession();
      }
      await saveCaptureSession(
        {
          ...current,
          captureLease: {
            operationId,
            tabId: tab.id,
            kind: "region",
          },
          error: null,
          status: "capturing",
        },
        requestedGeneration,
      );
      if (requestedGeneration !== contextGeneration) {
        return loadSession();
      }
      try {
        const frozenFrame = await captureActiveFrame(tab);
        await assertActiveTarget(tab);
        const result = (await chromeAdapter.sendTabMessage(tab.id, {
          type: "BEGIN_FROZEN_SNIP",
          dataUrl: frozenFrame,
        })) as { dataUrl?: string; error?: string } | null;
        if (requestedGeneration !== contextGeneration) {
          return loadSession();
        }
        if (!result) {
          const latest = await loadSession();
          if (latest.captureLease?.operationId !== operationId) {
            return latest;
          }
          return saveCaptureSession(
            {
              ...latest,
              captureLease: null,
              status: current.strategies.length > 0 ? "ready" : "idle",
            },
            requestedGeneration,
          );
        }
        if (result.error || !result.dataUrl) {
          throw new Error(result.error ?? "Mochi could not crop that capture.");
        }
        await assertActiveTarget(tab);
        const dataUrl = await normalizeImage(result.dataUrl);
        if (requestedGeneration !== contextGeneration) {
          return loadSession();
        }
        await assertActiveTarget(tab);
        const latest = await loadSession();
        if (latest.captureLease?.operationId !== operationId) {
          return latest;
        }
        assertCaptureCapacity(latest);
        return saveCaptureSession(
          reduceSession(latest, {
            type: "capture-added",
            capture: {
              id: randomId(),
              dataUrl,
              ...source,
              capturedAt: now().toISOString(),
              kind: "region",
            },
          }),
          requestedGeneration,
        );
      } catch (error) {
        if (requestedGeneration !== contextGeneration) {
          return loadSession();
        }
        const message =
          error instanceof Error ? error.message : "Mochi could not finish.";
        await saveCaptureSession(
          reduceSession(await loadSession(), {
            type: "failed",
            error: message,
          }),
          requestedGeneration,
        );
        throw error;
      }
    });
  }

  async function analyze() {
    const session = await loadSession();
    if (session.status === "analyzing") {
      throw new Error("Mochi is already analyzing this context.");
    }
    if (session.captures.length === 0) {
      throw new Error("Capture at least one page before analysis.");
    }
    const tab = await activeTab();
    const manifest = await discoverFieldManifest(tab.id);

    await saveSession(
      reduceSession(session, { type: "analysis-started" }),
    );
    const contextKey = JSON.stringify({
      captures: session.captures.map(({ id }) => id),
      preset: session.preset,
      taskHint: session.taskHint,
    });
    const requestBody = JSON.stringify({
        preset: session.preset,
        taskHint: session.taskHint,
        screenshots: session.captures.map(
          ({ dataUrl, sourceUrl, sourceTitle, capturedAt, kind }) => ({
            dataUrl,
            sourceUrl,
            sourceTitle,
            capturedAt,
            kind,
          }),
        ),
        fields: manifest.fields,
      });
    async function requestAnalysis(forceRefresh = false) {
      return fetchFromVercel(ANALYZE_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await getConnectorToken(forceRefresh)}`,
          "content-type": "application/json",
          "x-mochi-extension-id": extensionId,
        },
        body: requestBody,
      });
    }
    let response = await requestAnalysis();
    if (response.status === 401) {
      connectorToken = null;
      response = await requestAnalysis(true);
    }
    const body = (await response.json()) as {
      error?: string;
      strategies?: unknown[];
    };
    if (!response.ok) {
      throw new Error(body.error ?? `Analysis failed (${response.status}).`);
    }
    if (
      body.strategies?.length !== 3 ||
      !body.strategies.every(isStrategy)
    ) {
      throw new Error("Vercel returned an invalid three-strategy response.");
    }

    const latest = await loadSession();
    const latestContextKey = JSON.stringify({
      captures: latest.captures.map(({ id }) => id),
      preset: latest.preset,
      taskHint: latest.taskHint,
    });
    if (
      latest.status !== "analyzing" ||
      latestContextKey !== contextKey
    ) {
      return latest;
    }
    return saveSession(
      reduceSession(latest, {
        type: "analysis-succeeded",
        strategies: body.strategies,
        target: {
          tabId: tab.id,
          windowId: tab.windowId,
          tabUrl: tab.url,
          documentId: manifest.documentId,
          fieldManifestKey: fieldManifestKey(manifest.fields),
        },
      }),
    );
  }

  async function getConnectorToken(forceRefresh = false) {
    if (
      !forceRefresh &&
      connectorToken &&
      connectorToken.expiresAt > now().getTime() + 30_000
    ) {
      return connectorToken.value;
    }
    const sessionHeaders = {
      "content-type": "application/json",
      "x-mochi-extension-id": extensionId,
      "x-mochi-extension-version": "0.1.0",
    };
    const stableInstallId = await getInstallId();
    let response = await fetchFromVercel(CONNECTOR_SESSION_URL, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ installId: stableInstallId }),
    });
    let payload = (await response.json()) as {
      challengeToken?: string;
      difficulty?: number;
      error?: string;
      token?: string;
      expiresAt?: number;
    };
    if (
      response.status === 428 &&
      typeof payload.challengeToken === "string" &&
      typeof payload.difficulty === "number"
    ) {
      const solution = await solveChallenge(
        payload.challengeToken,
        payload.difficulty,
      );
      response = await fetchFromVercel(CONNECTOR_SESSION_URL, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          installId: stableInstallId,
          challengeToken: payload.challengeToken,
          solution,
        }),
      });
      payload = (await response.json()) as typeof payload;
    }
    if (
      !response.ok ||
      typeof payload.token !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      throw new Error(
        payload.error ?? "Mochi could not authorize Page Agent.",
      );
    }
    connectorToken = {
      value: payload.token,
      expiresAt: payload.expiresAt,
    };
    return payload.token;
  }

  async function requestPageAgent(body: string, token: string) {
    return fetchFromVercel(PAGE_AGENT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-mochi-extension-id": extensionId,
      },
      body,
    });
  }

  async function assertLiveExecution(executionId: string) {
    if (
      !executionTarget ||
      !activeExecutionId ||
      executionId !== activeExecutionId
    ) {
      throw new Error(
        "This Page Agent execution is no longer active. Mochi stopped it.",
      );
    }
    return assertActiveTarget(executionTarget);
  }

  async function assertStoredExecution(executionId: string) {
    const lease = (await loadSession()).executionLease;
    if (
      cancelRequested ||
      !lease ||
      lease.executionId !== executionId
    ) {
      throw new Error(
        "This execution was cancelled before Mochi could start the page driver.",
      );
    }
    return lease;
  }

  async function fetchPageAgent(
    body: string,
    executionId: string,
  ): Promise<PageAgentFetchResponse> {
    await assertLiveExecution(executionId);
    let response = await requestPageAgent(
      body,
      await getConnectorToken(),
    );
    if (response.status === 401) {
      connectorToken = null;
      response = await requestPageAgent(
        body,
        await getConnectorToken(true),
      );
    }
    try {
      await assertLiveExecution(executionId);
    } catch (error) {
      if (executionTarget) {
        await chromeAdapter
          .sendTabMessage(executionTarget.id, { type: "CANCEL_EXECUTION" })
          .catch(() => undefined);
      }
      throw error;
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText: await response.text(),
    };
  }

  async function authorizeSubmit(
    executionId: string,
    documentId: string,
  ) {
    const lease = await assertStoredExecution(executionId);
    if (lease.documentId !== documentId) {
      throw new Error(
        "The form document changed before submission. Mochi stopped.",
      );
    }
    const tab = await assertLiveExecution(executionId);
    const session = await loadSession();
    if (
      !session.analysisTarget ||
      session.analysisTarget.documentId !== documentId
    ) {
      throw new Error(
        "The analyzed form is no longer current. Mochi did not submit.",
      );
    }
    await assertDocumentTarget(session.analysisTarget, tab);
    await assertLiveExecution(executionId);
    await assertStoredExecution(executionId);
    return { authorized: true };
  }

  function assertExecutionContext(generation: number) {
    if (generation !== executionContextGeneration) {
      throw new Error(
        "Mochi's shared context changed before execution began. Review it again.",
      );
    }
  }

  async function discardInvalidatedExecution(executionId: string) {
    const current = await loadSession();
    if (current.executionLease?.executionId === executionId) {
      await saveSession(createEmptySession());
    }
  }

  async function commitExecutionSuccess(
    executionId: string,
    generation: number,
    summary: ExecutionSummary,
  ) {
    const observed = await loadSession();
    if (
      cancelRequested ||
      cancelConfirmed ||
      generation !== executionContextGeneration ||
      observed.executionLease?.executionId !== executionId
    ) {
      return false;
    }
    return queueSessionWrite(async () => {
      const current =
        (await chromeAdapter.getSession()) ?? createEmptySession();
      if (
        cancelRequested ||
        cancelConfirmed ||
        generation !== executionContextGeneration ||
        current.executionLease?.executionId !== executionId
      ) {
        return false;
      }
      const session = reduceSession(current, {
        type: "execution-succeeded",
        summary,
      });
      await chromeAdapter.setSession(session);
      await chromeAdapter.broadcast({ type: "SESSION_UPDATED", session });
      return true;
    });
  }

  function runClaimedExecution<T>(
    operation: (generation: number) => Promise<T>,
  ): Promise<T> {
    if (executionOperationClaimed) {
      throw new Error("Mochi is already executing on another page.");
    }
    if (executionContextMutations > 0) {
      throw new Error(
        "Mochi's shared context is changing. Review it before executing.",
      );
    }
    executionOperationClaimed = true;
    cancelRequested = false;
    cancelConfirmed = false;
    const generation = executionContextGeneration;
    const pending = operation(generation);
    activeExecutionOperation = pending;
    return pending.finally(() => {
      if (activeExecutionOperation === pending) {
        activeExecutionOperation = null;
      }
      executionOperationClaimed = false;
    });
  }

  function executeSelectedStrategy() {
    return runClaimedExecution(executeSelectedStrategyClaimed);
  }

  async function executeSelectedStrategyClaimed(
    generation: number,
  ) {
    const session = await loadSession();
    assertExecutionContext(generation);
    if (session.executionLease) {
      throw new Error(
        "Mochi still has an execution to cancel or finish before starting another.",
      );
    }
    const strategy = session.strategies.find(
      ({ id }) => id === session.selectedStrategyId,
    );
    if (!strategy) {
      throw new Error("Choose one of Mochi's three strategies first.");
    }

    if (session.executionMode === "review") {
      return {
        status: "preview",
        adapter: "page-agent",
        values: Object.fromEntries(
          Object.entries(strategy.fields)
            .filter(([, field]) => field.value.trim().length > 0)
            .map(([key, field]) => [key, field.value]),
        ),
        changedFields: 0,
      };
    }

    const tab = await activeTab();
    assertExecutionContext(generation);
    const analysisTarget = await assertAnalyzedTarget(session, tab);
    assertExecutionContext(generation);
    const executionId = randomId();
    const executionLease = {
      executionId,
      tabId: tab.id,
      windowId: tab.windowId,
      tabUrl: tab.url,
      documentId: analysisTarget.documentId,
      agentStarted: false,
    };
    executionTarget = tab;
    activeExecutionId = executionId;
    let agentAttempted = false;
    let submissionGuardInstalled = false;
    try {
      assertExecutionContext(generation);
      await saveSession(
        reduceSession(session, {
          type: "execution-started",
          lease: executionLease,
        }),
      );
      assertExecutionContext(generation);

      if (session.executionMode === "autopilot") {
        for (let countdown = 3; countdown > 0; countdown -= 1) {
          assertExecutionContext(generation);
          await saveSession({
            ...(await loadSession()),
            executionCountdown: countdown,
            status: "executing",
          });
          assertExecutionContext(generation);
          await delay(1_000);
          if (cancelRequested) {
            return {
              status: "cancelled",
              adapter: "page-agent",
              values: {},
              changedFields: 0,
            };
          }
          assertExecutionContext(generation);
          await assertActiveTarget(tab);
        }
      }
      assertExecutionContext(generation);
      await saveSession({
        ...(await loadSession()),
        executionCountdown: null,
        status: "executing",
      });
      assertExecutionContext(generation);

      await assertActiveTarget(tab);
      assertExecutionContext(generation);
      await chromeAdapter.setSubmissionGuard(tab.id, true);
      submissionGuardInstalled = true;
      assertExecutionContext(generation);
      await assertStoredExecution(executionId);
      await assertDocumentTarget(analysisTarget, tab);
      assertExecutionContext(generation);
      await chromeAdapter.executeAgent(tab.id);
      assertExecutionContext(generation);
      await assertActiveTarget(tab);
      await assertStoredExecution(executionId);
      await assertDocumentTarget(analysisTarget, tab);
      assertExecutionContext(generation);
      agentAttempted = true;
      await saveSession({
        ...(await loadSession()),
        executionLease: {
          ...executionLease,
          agentStarted: true,
        },
      });
      assertExecutionContext(generation);
      await assertStoredExecution(executionId);
      await assertDocumentTarget(analysisTarget, tab);
      assertExecutionContext(generation);
      const result = (await chromeAdapter.sendTabMessage(tab.id, {
        type: "RUN_PAGE_AGENT",
        strategy,
        mode: session.executionMode,
        executionId,
        documentId: analysisTarget.documentId,
      })) as {
        error?: string;
        status?: string;
        adapter?: "page-agent" | "exact-fallback";
        changedFields?: number;
        values?: Record<string, string>;
        warning?: string;
      };
      if (result?.error) {
        throw new Error(result.error);
      }
      if (cancelRequested && !cancelConfirmed) {
        return {
          status: "cancelled",
          adapter: "page-agent",
          values: result?.values ?? {},
          changedFields: 0,
        };
      }
      if (
        generation !== executionContextGeneration &&
        (cancelConfirmed || result?.status === "cancelled")
      ) {
        await discardInvalidatedExecution(executionId);
        return {
          status: "cancelled",
          adapter: "page-agent",
          values: result?.values ?? {},
          changedFields: 0,
        };
      }
      assertExecutionContext(generation);
      if (cancelConfirmed || result?.status === "cancelled") {
        await saveSession({
          ...(await loadSession()),
          error: null,
          executionLease: null,
          executionCountdown: null,
          status: "ready",
        });
        return {
          status: "cancelled",
          adapter: "page-agent",
          values: result?.values ?? {},
          changedFields: 0,
        };
      }

      assertExecutionContext(generation);
      const committed = await commitExecutionSuccess(
        executionId,
        generation,
        {
          tabId: tab.id,
          windowId: tab.windowId,
          tabUrl: tab.url,
          documentId: analysisTarget.documentId,
          fieldManifestKey: analysisTarget.fieldManifestKey,
          changedFields: result?.changedFields ?? 0,
          completedAt: now().toISOString(),
          adapter: result?.adapter ?? "page-agent",
          status:
            result?.status === "submitted" ? "submitted" : "filled",
          ...(result?.warning ? { warning: result.warning } : {}),
        },
      );
      if (!committed) {
        return {
          status: "cancelled",
          adapter: "page-agent",
          values: result?.values ?? {},
          changedFields: 0,
        };
      }
      return result;
    } catch (error) {
      if (cancelRequested && !cancelConfirmed) {
        return {
          status: "cancelled",
          adapter: "page-agent",
          values: {},
          changedFields: 0,
        };
      }
      if (generation !== executionContextGeneration) {
        await discardInvalidatedExecution(executionId);
        throw error;
      }
      if (cancelConfirmed) {
        await saveSession({
          ...(await loadSession()),
          error: null,
          executionLease: null,
          executionCountdown: null,
          status: "ready",
        });
        return {
          status: "cancelled",
          adapter: "page-agent",
          values: {},
          changedFields: 0,
        };
      }
      if (agentAttempted) {
        const reason =
          error instanceof Error ? error.message : "Page Agent stopped.";
        const offered = reduceSession(await loadSession(), {
          type: "fallback-offered",
          offer: {
            tabId: tab.id,
            windowId: tab.windowId,
            tabUrl: tab.url,
            documentId: analysisTarget.documentId,
            fieldManifestKey: analysisTarget.fieldManifestKey,
            strategy: structuredClone(strategy),
            reason,
          },
        });
        await saveSession({
          ...offered,
          error:
            "Page Agent stopped without leaving partial changes. You can retry or explicitly approve safe exact fill.",
        });
      } else {
        await fail(error);
      }
      throw error;
    } finally {
      if (submissionGuardInstalled) {
        await chromeAdapter
          .setSubmissionGuard(tab.id, false)
          .catch(() => undefined);
      }
      activeExecutionId = null;
      executionTarget = null;
    }
  }

  async function cancelExecution() {
    cancelRequested = true;
    const session = await loadSession();
    const lease = session.executionLease;
    const tabId = executionTarget?.id ?? lease?.tabId;
    activeExecutionId = null;
    if (tabId !== undefined && lease?.agentStarted) {
      const result = (await chromeAdapter
        .sendTabMessage(tabId, { type: "CANCEL_EXECUTION" })
        .catch((error: unknown) => ({
          error:
            error instanceof Error
              ? error.message
              : "The content executor did not respond.",
        }))) as { status?: string; error?: string } | null;
      if (result?.status !== "cancelled" || result.error) {
        const target = await chromeAdapter.getTab(tabId);
        const currentManifest = await chromeAdapter
          .sendTabMessage(tabId, { type: "DISCOVER_FIELDS" })
          .catch(() => null);
        const currentDocumentId =
          typeof currentManifest === "object" &&
          currentManifest !== null &&
          "documentId" in currentManifest &&
          typeof currentManifest.documentId === "string"
            ? currentManifest.documentId
            : null;
        const originalDocumentIsGone =
          !target ||
          target.windowId !== lease.windowId ||
          target.url !== lease.tabUrl ||
          currentDocumentId !== lease.documentId;
        if (!originalDocumentIsGone) {
          const message =
            result?.error ??
            "Mochi could not confirm that Page Agent stopped.";
          await saveSession({
            ...session,
            error: message,
            status: "error",
          });
          throw new Error(message);
        }
      }
      cancelConfirmed = true;
    } else {
      cancelConfirmed = true;
    }
    if (tabId !== undefined) {
      await chromeAdapter
        .setSubmissionGuard(tabId, false)
        .catch(() => undefined);
    }
    return saveSession({
      ...(await loadSession()),
      error: null,
      executionLease: null,
      executionCountdown: null,
      status: "ready",
    });
  }

  function executeExactFallback() {
    return runClaimedExecution(executeExactFallbackClaimed);
  }

  async function executeExactFallbackClaimed(
    generation: number,
  ) {
    const session = await loadSession();
    assertExecutionContext(generation);
    if (session.executionLease) {
      throw new Error(
        "Mochi still has an execution to cancel or finish before using fallback.",
      );
    }
    const offer = session.fallbackOffer;
    if (!offer) {
      throw new Error("There is no exact-fill fallback awaiting approval.");
    }
    const strategy = offer.strategy;
    const tab = await activeTab();
    assertExecutionContext(generation);
    await assertDocumentTarget(offer, tab);
    assertExecutionContext(generation);

    executionTarget = tab;
    const executionId = randomId();
    activeExecutionId = executionId;
    assertExecutionContext(generation);
    await saveSession(
      reduceSession(session, {
        type: "execution-started",
        lease: {
          executionId,
          tabId: tab.id,
          windowId: tab.windowId,
          tabUrl: tab.url,
          documentId: offer.documentId,
          agentStarted: false,
        },
      }),
    );
    assertExecutionContext(generation);
    let submissionGuardInstalled = false;
    try {
      await assertActiveTarget(tab);
      assertExecutionContext(generation);
      await chromeAdapter.setSubmissionGuard(tab.id, true);
      submissionGuardInstalled = true;
      assertExecutionContext(generation);
      await assertStoredExecution(executionId);
      await assertDocumentTarget(offer, tab);
      assertExecutionContext(generation);
      await chromeAdapter.executeAgent(tab.id);
      assertExecutionContext(generation);
      await assertActiveTarget(tab);
      await assertStoredExecution(executionId);
      await assertDocumentTarget(offer, tab);
      assertExecutionContext(generation);
      await saveSession({
        ...(await loadSession()),
        executionLease: {
          executionId,
          tabId: tab.id,
          windowId: tab.windowId,
          tabUrl: tab.url,
          documentId: offer.documentId,
          agentStarted: true,
        },
      });
      assertExecutionContext(generation);
      await assertStoredExecution(executionId);
      await assertDocumentTarget(offer, tab);
      assertExecutionContext(generation);
      const result = (await chromeAdapter.sendTabMessage(tab.id, {
        type: "RUN_EXACT_FALLBACK",
        strategy,
        executionId,
        documentId: offer.documentId,
      })) as {
        error?: string;
        status?: string;
        adapter?: "exact-fallback";
        changedFields?: number;
        warning?: string;
      };
      if (result?.error) {
        throw new Error(result.error);
      }
      if (cancelRequested && !cancelConfirmed) {
        return {
          status: "cancelled",
          adapter: "exact-fallback",
          changedFields: 0,
        };
      }
      if (
        generation !== executionContextGeneration &&
        (cancelConfirmed || result?.status === "cancelled")
      ) {
        await discardInvalidatedExecution(executionId);
        return {
          status: "cancelled",
          adapter: "exact-fallback",
          changedFields: 0,
        };
      }
      assertExecutionContext(generation);
      if (cancelConfirmed || result?.status === "cancelled") {
        await saveSession({
          ...(await loadSession()),
          error: null,
          executionLease: null,
          executionCountdown: null,
          status: "ready",
        });
        return {
          status: "cancelled",
          adapter: "exact-fallback",
          changedFields: 0,
        };
      }
      assertExecutionContext(generation);
      const committed = await commitExecutionSuccess(
        executionId,
        generation,
        {
          tabId: tab.id,
          windowId: tab.windowId,
          tabUrl: tab.url,
          documentId: offer.documentId,
          fieldManifestKey: offer.fieldManifestKey,
          changedFields: result?.changedFields ?? 0,
          completedAt: now().toISOString(),
          adapter: "exact-fallback",
          status: "filled",
          ...(result?.warning ? { warning: result.warning } : {}),
        },
      );
      return committed
        ? result
        : {
            status: "cancelled",
            adapter: "exact-fallback",
            changedFields: 0,
          };
    } catch (error) {
      if (cancelRequested && !cancelConfirmed) {
        return {
          status: "cancelled",
          adapter: "exact-fallback",
          changedFields: 0,
        };
      }
      if (generation !== executionContextGeneration) {
        await discardInvalidatedExecution(executionId);
        throw error;
      }
      if (cancelConfirmed) {
        return saveSession({
          ...(await loadSession()),
          error: null,
          executionLease: null,
          executionCountdown: null,
          status: "ready",
        });
      }
      await fail(error);
      throw error;
    } finally {
      if (submissionGuardInstalled) {
        await chromeAdapter
          .setSubmissionGuard(tab.id, false)
          .catch(() => undefined);
      }
      activeExecutionId = null;
      executionTarget = null;
    }
  }

  async function undoLastExecution() {
    const requestedGeneration = contextGeneration;
    const session = await loadSession();
    if (!session.lastExecution) {
      throw new Error("There is no Mochi fill to undo.");
    }
    const target = session.lastExecution;
    const tab = await activeTab();
    await assertDocumentTarget(target, tab);
    await chromeAdapter.setSubmissionGuard(target.tabId, true);
    try {
      const result = (await chromeAdapter.sendTabMessage(target.tabId, {
        type: "RUN_UNDO",
        documentId: target.documentId,
      })) as { status?: string } | null;
      if (result?.status !== "undone") {
        throw new Error(
          "Mochi could not confirm Undo on the original form.",
        );
      }
    } finally {
      await chromeAdapter
        .setSubmissionGuard(target.tabId, false)
        .catch(() => undefined);
    }
    if (requestedGeneration !== contextGeneration) {
      return loadSession();
    }
    return saveSession({
      ...session,
      lastExecution: null,
      error: null,
      status: "ready",
    });
  }

  async function dispatchMessage(
    message: ConnectorMessage,
    requestedClearGeneration: number,
    executionWasClaimed: boolean,
  ): Promise<unknown> {
    const liveSession = await loadSession();
    if (
      (message.type === "CAPTURE_VIEWPORT" ||
        message.type === "START_SNIP") &&
      requestedClearGeneration !== contextGeneration
    ) {
      return liveSession;
    }
    if (
      liveSession.executionLease &&
      ![
        "GET_SESSION",
        "OPEN_PANEL",
        "FETCH_PAGE_AGENT",
        "AUTHORIZE_SUBMIT",
        "RELEASE_EXECUTION_GUARD",
        "CANCEL_EXECUTION",
        "CLEAR_SESSION",
      ].includes(message.type)
    ) {
      throw new Error(
        "Mochi is executing. Cancel or finish it before changing shared context.",
      );
    }

    switch (message.type) {
      case "GET_SESSION":
        return loadSession();
      case "OPEN_PANEL": {
        const tab = await activeTab();
        await chromeAdapter.openPanel(tab.windowId);
        return { ok: true };
      }
      case "CAPTURE_VIEWPORT":
        return captureViewport(requestedClearGeneration);
      case "START_SNIP":
        return captureRegion(requestedClearGeneration);
      case "REMOVE_CAPTURE":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "capture-removed",
            captureId: message.captureId,
          }),
        );
      case "CLEAR_SESSION":
        if (liveSession.captureLease?.kind === "region") {
          await chromeAdapter
            .sendTabMessage(liveSession.captureLease.tabId, {
              type: "CANCEL_SNIP",
            })
            .catch(() => undefined);
        }
        if (
          executionWasClaimed ||
          executionOperationClaimed ||
          liveSession.executionLease
        ) {
          await cancelExecution();
        }
        return saveSession(createEmptySession());
      case "SET_PRESET":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "preset-changed",
            preset: message.preset,
          }),
        );
      case "SET_TASK_HINT":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "task-hint-changed",
            taskHint: message.taskHint,
          }),
        );
      case "SELECT_STRATEGY":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "strategy-selected",
            strategyId: message.strategyId,
          }),
        );
      case "SET_MODE":
        return saveSession(
          reduceSession(await loadSession(), {
            type: "mode-changed",
            mode: message.mode,
          }),
        );
      case "ANALYZE":
        if (analysisInFlight) {
          throw new Error("Mochi is already analyzing this context.");
        }
        analysisInFlight = true;
        try {
          return await analyze();
        } catch (error) {
          await fail(error);
          throw error;
        } finally {
          analysisInFlight = false;
        }
      case "FETCH_PAGE_AGENT":
        return fetchPageAgent(message.body, message.executionId);
      case "AUTHORIZE_SUBMIT":
        return authorizeSubmit(
          message.executionId,
          message.documentId,
        );
      case "RELEASE_EXECUTION_GUARD": {
        const lease = (await loadSession()).executionLease;
        if (!lease || lease.executionId !== message.executionId) {
          return { released: false };
        }
        await chromeAdapter.setSubmissionGuard(lease.tabId, false);
        return { released: true };
      }
      case "EXECUTE":
        return executeSelectedStrategy();
      case "EXECUTE_EXACT_FALLBACK":
        return executeExactFallback();
      case "CANCEL_EXECUTION":
        return cancelExecution();
      case "UNDO":
        return undoLastExecution();
      default:
        throw new Error(`Mochi has not enabled ${message.type} yet.`);
    }
  }

  async function handle(rawMessage: unknown): Promise<unknown> {
    const message = parseConnectorMessage(rawMessage);
    if (!message) {
      throw new Error("Mochi ignored an invalid connector message.");
    }

    if (
      message.type === "CANCEL_EXECUTION" ||
      message.type === "CLEAR_SESSION"
    ) {
      cancelRequested = true;
    }
    const executionWasClaimed = executionOperationClaimed;
    const requestedClearGeneration = contextGeneration;
    const changesExecutionContext = EXECUTION_CONTEXT_MUTATIONS.has(
      message.type,
    );
    if (clearOperationClaimed && changesExecutionContext) {
      throw new Error("Mochi is already clearing its shared context.");
    }
    if (
      changesExecutionContext &&
      message.type !== "CLEAR_SESSION" &&
      executionOperationClaimed
    ) {
      throw new Error(
        "Mochi is executing. Cancel or finish it before changing shared context.",
      );
    }
    if (changesExecutionContext) {
      executionContextGeneration += 1;
      executionContextMutations += 1;
    }
    if (message.type === "CLEAR_SESSION") {
      clearOperationClaimed = true;
      contextGeneration += 1;
    }
    try {
      return await dispatchMessage(
        message,
        requestedClearGeneration,
        executionWasClaimed,
      );
    } finally {
      if (changesExecutionContext) {
        executionContextMutations -= 1;
      }
      if (message.type === "CLEAR_SESSION") {
        clearOperationClaimed = false;
      }
    }
  }

  return { handle };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  const chromeAdapter = createChromeAdapter();
  const coordinator = createBackgroundCoordinator({
    chrome: chromeAdapter,
    delay,
    fetch,
    normalizeImage: normalizeCapturedImage,
    extensionId: chrome.runtime.id,
  });

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    void chromeAdapter.setSession(createEmptySession());
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void coordinator.handle(message).then(
      (result) => sendResponse({ ok: true, result }),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Mochi could not finish.",
        }),
    );
    return true;
  });
}
