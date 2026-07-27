export type ValidationState = "untested" | "valid" | "invalid";

export interface ProviderValidation {
  status: ValidationState;
  checkedAt?: string;
}

export interface ProviderSettings {
  version: 1;
  openAIApiKey: string;
  openAIValidation: ProviderValidation;
  exaApiKey?: string;
  exaValidation?: ProviderValidation;
}

export interface ProviderStatus {
  configured: boolean;
  openAI: "missing" | ValidationState;
  exa: "missing" | ValidationState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isProviderKeyCandidate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function normalizedKey(value: unknown, provider: "OpenAI" | "Exa") {
  const key = typeof value === "string" ? value.trim() : "";
  if (!isProviderKeyCandidate(key)) {
    throw new Error(`Enter a valid ${provider} API key.`);
  }
  return key;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    !Number.isNaN(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function parseValidation(value: unknown): ProviderValidation | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["status", "checkedAt"]) ||
    (value.status !== "untested" &&
      value.status !== "valid" &&
      value.status !== "invalid") ||
    (value.checkedAt !== undefined && !isIsoTimestamp(value.checkedAt)) ||
    (value.status !== "untested" && value.checkedAt === undefined)
  ) {
    return null;
  }
  return {
    status: value.status,
    ...(value.checkedAt ? { checkedAt: value.checkedAt as string } : {}),
  };
}

export function createUntestedProviderSettings(input: {
  openAIApiKey: string;
  exaApiKey?: string;
}): ProviderSettings {
  const openAIApiKey = normalizedKey(input.openAIApiKey, "OpenAI");
  const exaApiKey =
    typeof input.exaApiKey === "string" && input.exaApiKey.trim()
      ? normalizedKey(input.exaApiKey, "Exa")
      : undefined;
  return {
    version: 1,
    openAIApiKey,
    openAIValidation: { status: "untested" },
    ...(exaApiKey
      ? {
          exaApiKey,
          exaValidation: { status: "untested" as const },
        }
      : {}),
  };
}

export function parseProviderSettings(
  value: unknown,
): ProviderSettings | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "version",
      "openAIApiKey",
      "openAIValidation",
      "exaApiKey",
      "exaValidation",
    ]) ||
    value.version !== 1 ||
    !isProviderKeyCandidate(value.openAIApiKey)
  ) {
    return null;
  }
  const openAIValidation = parseValidation(value.openAIValidation);
  if (!openAIValidation) return null;

  const hasExa = value.exaApiKey !== undefined;
  if (
    hasExa !== (value.exaValidation !== undefined) ||
    (hasExa && !isProviderKeyCandidate(value.exaApiKey))
  ) {
    return null;
  }
  const exaValidation = hasExa
    ? parseValidation(value.exaValidation)
    : undefined;
  if (hasExa && !exaValidation) return null;

  return {
    version: 1,
    openAIApiKey: value.openAIApiKey,
    openAIValidation,
    ...(hasExa
      ? {
          exaApiKey: value.exaApiKey as string,
          exaValidation: exaValidation!,
        }
      : {}),
  };
}

export function providerStatus(
  settings: ProviderSettings | null,
): ProviderStatus {
  return {
    configured: settings?.openAIValidation.status === "valid",
    openAI: settings?.openAIValidation.status ?? "missing",
    exa:
      settings?.exaApiKey && settings.exaValidation
        ? settings.exaValidation.status
        : "missing",
  };
}

export function markProviderValidation(
  settings: ProviderSettings,
  provider: "openAI" | "exa",
  status: ValidationState,
  checkedAt: string,
): ProviderSettings {
  if (!isIsoTimestamp(checkedAt)) {
    throw new Error("Provider validation time is invalid.");
  }
  const validation: ProviderValidation = { status, checkedAt };
  if (provider === "openAI") {
    return { ...settings, openAIValidation: validation };
  }
  if (!settings.exaApiKey) {
    throw new Error("Exa is not configured.");
  }
  return { ...settings, exaValidation: validation };
}
