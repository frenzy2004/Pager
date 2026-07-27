import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.resetModules();
});

describe("browser Mochi session", () => {
  it("solves the session challenge before sending authorized analysis", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        requests.push({ input: String(input), init });
        if (requests.length === 1) {
          return new Response(
            JSON.stringify({
              challengeToken:
                "web-proof-challenge-token-with-at-least-forty-characters",
              difficulty: 8,
              expiresAt: Date.now() + 60_000,
            }),
            { status: 428 },
          );
        }
        if (requests.length === 2) {
          return new Response(
            JSON.stringify({
              token: "signed-web-token",
              expiresAt: Date.now() + 15 * 60_000,
            }),
            { status: 200 },
          );
        }
        return new Response('{"strategies":[]}', { status: 200 });
      });
    const { fetchWithMochiSession } = await import(
      "@/lib/mochi/browser-session"
    );

    const response = await fetchWithMochiSession("/api/analyze", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      challengeToken:
        "web-proof-challenge-token-with-at-least-forty-characters",
      solution: expect.stringMatching(/^\d+$/),
    });
    expect(new Headers(requests[2]?.init?.headers).get("authorization")).toBe(
      "Bearer signed-web-token",
    );
  });
});
