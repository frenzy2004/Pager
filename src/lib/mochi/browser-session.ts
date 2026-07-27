"use client";

import { MOCHI_WEB_CLIENT_ID } from "@/lib/mochi/connector-constants";
import { solveProofOfWork } from "@/lib/mochi/proof-of-work";

const INSTALL_KEY = "mochi-web-install-id";
let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;
let memoryInstallId: string | null = null;

function installId() {
  if (memoryInstallId) return memoryInstallId;
  try {
    const stored = window.localStorage.getItem(INSTALL_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,120}$/.test(stored)) {
      memoryInstallId = stored;
      return stored;
    }
  } catch {
    // Privacy modes can disable localStorage; this tab still gets one ID.
  }
  const generated = crypto.randomUUID();
  memoryInstallId = generated;
  try {
    window.localStorage.setItem(INSTALL_KEY, generated);
  } catch {
    // The in-memory ID remains stable for this page lifecycle.
  }
  return generated;
}

async function parseSessionResponse(response: Response) {
  const body = (await response.json()) as {
    challengeToken?: string;
    difficulty?: number;
    error?: string;
    token?: string;
    expiresAt?: number;
  };
  return { body, response };
}

async function mintToken() {
  const headers = {
    "content-type": "application/json",
    "x-mochi-client-id": MOCHI_WEB_CLIENT_ID,
    "x-mochi-client-version": "0.1.0",
  };
  const stableInstallId = installId();
  let { body, response } = await parseSessionResponse(
    await fetch("/api/connector/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ installId: stableInstallId }),
    }),
  );
  if (
    response.status === 428 &&
    typeof body.challengeToken === "string" &&
    typeof body.difficulty === "number"
  ) {
    const solution = await solveProofOfWork(
      body.challengeToken,
      body.difficulty,
    );
    ({ body, response } = await parseSessionResponse(
      await fetch("/api/connector/session", {
        method: "POST",
        headers,
        body: JSON.stringify({
          installId: stableInstallId,
          challengeToken: body.challengeToken,
          solution,
        }),
      }),
    ));
  }
  if (
    !response.ok ||
    typeof body.token !== "string" ||
    typeof body.expiresAt !== "number"
  ) {
    throw new Error(body.error ?? "Mochi could not authorize analysis.");
  }
  cachedToken = { value: body.token, expiresAt: body.expiresAt };
  return body.token;
}

async function sessionToken(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedToken &&
    cachedToken.expiresAt > Date.now() + 30_000
  ) {
    return cachedToken.value;
  }
  if (!pendingToken || forceRefresh) {
    pendingToken = mintToken().finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
}

export async function fetchWithMochiSession(
  input: string,
  init: RequestInit,
) {
  async function request(forceRefresh: boolean) {
    const headers = new Headers(init.headers);
    headers.set(
      "authorization",
      `Bearer ${await sessionToken(forceRefresh)}`,
    );
    headers.set("x-mochi-client-id", MOCHI_WEB_CLIENT_ID);
    return fetch(input, { ...init, headers });
  }

  let response = await request(false);
  if (response.status === 401) {
    cachedToken = null;
    response = await request(true);
  }
  return response;
}
