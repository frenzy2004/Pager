import { describe, expect, it, vi } from "vitest";

import { EXA_SEARCH_URL, searchExa, testExaKey } from "./exa";

const signal = new AbortController().signal;

describe("Exa provider", () => {
  it("tests an optional key with one bounded moderated search", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ results: [] }),
    );

    await testExaKey("exa-secret-key", fetcher, signal);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(EXA_SEARCH_URL);
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "exa-secret-key",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "OpenAI",
      type: "fast",
      numResults: 1,
      moderation: true,
    });
  });

  it("returns at most three bounded public sources", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        results: [
          {
            title: "Company",
            url: "https://company.example/about",
            highlights: ["A".repeat(1_300)],
          },
          {
            title: "News",
            url: "https://news.example/story",
            text: "Useful public context.",
          },
          { title: "", url: "https://invalid.example" },
          {
            title: "Fourth",
            url: "https://fourth.example",
            text: "Must be dropped.",
          },
        ],
      }),
    );

    const sources = await searchExa(
      "company product",
      "exa-secret-key",
      fetcher,
      signal,
    );

    expect(sources).toHaveLength(3);
    expect(sources[0]).toMatchObject({
      id: "exa-1",
      title: "Company",
      url: "https://company.example/about",
    });
    expect(sources[0]?.snippet).toHaveLength(1_200);
    expect(sources.map(({ title }) => title)).not.toContain("");
  });

  it("sanitizes an invalid optional key error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider secret", { status: 401 }));

    await expect(
      testExaKey("exa-secret-key", fetcher, signal),
    ).rejects.toThrow("Exa rejected this key.");
  });
});
