import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
export {
  MOCHI_EXTENSION_ID,
  MOCHI_WEB_CLIENT_ID,
} from "@/lib/mochi/connector-constants";

export const CONNECTOR_TOKEN_TTL_MS = 15 * 60_000;
export const CONNECTOR_CHALLENGE_TTL_MS = 2 * 60_000;

export interface ConnectorTokenPayload {
  v: 1;
  installId: string;
  extensionId: string;
  ipHash: string;
  issuedAt: number;
  expiresAt: number;
}

interface ConnectorChallengePayload {
  v: 1;
  type: "proof-of-work";
  extensionId: string;
  installId: string;
  ipHash: string;
  nonce: string;
  difficulty: number;
  issuedAt: number;
  expiresAt: number;
}

interface IssueConnectorTokenOptions {
  extensionId: string;
  installId: string;
  ip: string;
  now: number;
  secret: string;
}

interface VerifyConnectorTokenOptions {
  extensionId: string;
  ip: string;
  now: number;
  secret: string;
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function ipHash(ip: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`mochi-ip:${ip}`)
    .digest("base64url")
    .slice(0, 24);
}

function isPayload(value: unknown): value is ConnectorTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<ConnectorTokenPayload>;
  return (
    payload.v === 1 &&
    typeof payload.installId === "string" &&
    /^[A-Za-z0-9_-]{8,120}$/.test(payload.installId) &&
    typeof payload.extensionId === "string" &&
    /^[a-p]{32}$/.test(payload.extensionId) &&
    typeof payload.ipHash === "string" &&
    typeof payload.issuedAt === "number" &&
    typeof payload.expiresAt === "number"
  );
}

function isChallengePayload(
  value: unknown,
): value is ConnectorChallengePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<ConnectorChallengePayload>;
  return (
    payload.v === 1 &&
    payload.type === "proof-of-work" &&
    typeof payload.installId === "string" &&
    /^[A-Za-z0-9_-]{8,120}$/.test(payload.installId) &&
    typeof payload.extensionId === "string" &&
    /^[a-p]{32}$/.test(payload.extensionId) &&
    typeof payload.ipHash === "string" &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 12 &&
    typeof payload.difficulty === "number" &&
    Number.isInteger(payload.difficulty) &&
    payload.difficulty >= 8 &&
    payload.difficulty <= 24 &&
    typeof payload.issuedAt === "number" &&
    typeof payload.expiresAt === "number"
  );
}

function leadingZeroBits(bytes: Buffer) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function issueConnectorChallenge({
  difficulty,
  extensionId,
  installId,
  ip,
  nonce,
  now,
  secret,
}: IssueConnectorTokenOptions & {
  difficulty: number;
  nonce: string;
}) {
  if (secret.length < 32) {
    throw new Error("Mochi connector signing is not configured.");
  }
  const payload: ConnectorChallengePayload = {
    v: 1,
    type: "proof-of-work",
    extensionId,
    installId,
    ipHash: ipHash(ip, secret),
    nonce,
    difficulty,
    issuedAt: now,
    expiresAt: now + CONNECTOR_CHALLENGE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encoded}.${signature(encoded, secret)}`,
    expiresAt: payload.expiresAt,
  };
}

export function verifyConnectorChallenge(
  token: string,
  solution: string,
  {
    extensionId,
    installId,
    ip,
    now,
    secret,
  }: VerifyConnectorTokenOptions & { installId: string },
) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (
    !encoded ||
    !suppliedSignature ||
    extra ||
    !/^\d{1,10}$/.test(solution)
  ) {
    return false;
  }
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return false;
  }
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      !isChallengePayload(payload) ||
      payload.extensionId !== extensionId ||
      payload.installId !== installId ||
      payload.ipHash !== ipHash(ip, secret) ||
      payload.expiresAt <= now ||
      payload.issuedAt > now + 60_000 ||
      payload.expiresAt - payload.issuedAt !==
        CONNECTOR_CHALLENGE_TTL_MS
    ) {
      return false;
    }
    const digest = createHash("sha256")
      .update(`${token}:${solution}`)
      .digest();
    return leadingZeroBits(digest) >= payload.difficulty;
  } catch {
    return false;
  }
}

export function issueConnectorToken({
  extensionId,
  installId,
  ip,
  now,
  secret,
}: IssueConnectorTokenOptions) {
  if (secret.length < 32) {
    throw new Error("Mochi connector signing is not configured.");
  }
  const payload: ConnectorTokenPayload = {
    v: 1,
    installId,
    extensionId,
    ipHash: ipHash(ip, secret),
    issuedAt: now,
    expiresAt: now + CONNECTOR_TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyConnectorToken(
  token: string,
  { extensionId, ip, now, secret }: VerifyConnectorTokenOptions,
) {
  if (secret.length < 32) return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      !isPayload(payload) ||
      payload.extensionId !== extensionId ||
      payload.ipHash !== ipHash(ip, secret) ||
      payload.expiresAt <= now ||
      payload.issuedAt > now + 60_000 ||
      payload.expiresAt - payload.issuedAt !== CONNECTOR_TOKEN_TTL_MS
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

interface WindowState {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, WindowState>();

  take(key: string, limit: number, windowMs: number, now = Date.now()) {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}
