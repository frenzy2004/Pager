import type {
  ProviderFetch,
  ResearchSource,
} from "./openai";

export const EXA_SEARCH_URL = "https://api.exa.ai/search";

interface ExaSearchResult {
  title?: string;
  url?: string;
  highlights?: string[];
  text?: string;
}

function exaError(status: number) {
  if (status === 401 || status === 403) {
    return new Error("Exa rejected this key.");
  }
  if (status === 429) {
    return new Error("Exa rate limit or project quota reached.");
  }
  return new Error("Exa search was unavailable.");
}

async function exaRequest(
  apiKey: string,
  body: Record<string, unknown>,
  fetcher: ProviderFetch,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetcher(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error("Exa search was unavailable.");
  }
  if (!response.ok) throw exaError(response.status);
  return response;
}

export async function testExaKey(
  apiKey: string,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<void> {
  await exaRequest(
    apiKey,
    {
      query: "OpenAI",
      type: "fast",
      numResults: 1,
      moderation: true,
    },
    fetcher,
    signal,
  );
}

export async function searchExa(
  query: string,
  apiKey: string,
  fetcher: ProviderFetch,
  signal: AbortSignal,
): Promise<ResearchSource[]> {
  const response = await exaRequest(
    apiKey,
    {
      query,
      type: "fast",
      numResults: 3,
      moderation: true,
      contents: {
        highlights: {
          maxCharacters: 1_200,
        },
      },
    },
    fetcher,
    signal,
  );
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("Exa search was unavailable.");
  }
  const results =
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { results?: unknown }).results)
      ? ((value as { results: ExaSearchResult[] }).results ?? [])
      : [];
  return results
    .filter(
      (result): result is ExaSearchResult & {
        title: string;
        url: string;
      } => Boolean(result.title && result.url),
    )
    .slice(0, 3)
    .map((result, index) => ({
      id: `exa-${index + 1}`,
      title: result.title,
      url: result.url,
      snippet:
        result.highlights?.filter(Boolean).join(" ").slice(0, 1_200) ||
        result.text?.slice(0, 1_200),
    }));
}
