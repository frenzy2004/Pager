import { z } from "zod";

const actionSchemas = [
  z
    .object({
      done: z.object({
        text: z.string(),
        success: z.boolean().default(true),
      }),
    })
    .describe(
      "Complete task. Text is your final response to the user — keep it concise unless the user explicitly asks for detail.",
    ),
  z
    .object({
      wait: z.object({
        seconds: z.number().min(1).max(10).default(1),
      }),
    })
    .describe(
      "Wait for x seconds. Can be used to wait until the page or data is fully loaded.",
    ),
  z
    .object({
      input_text: z.object({
        index: z.int().min(0),
        text: z.string(),
      }),
    })
    .describe("Click and type text into an interactive input element"),
  z
    .object({
      select_dropdown_option: z.object({
        index: z.int().min(0),
        text: z.string(),
      }),
    })
    .describe(
      "Select dropdown option for interactive element index by the text of the option you want to select",
    ),
  z
    .object({
      scroll: z.object({
        down: z.boolean().default(true),
        num_pages: z.number().min(0).max(10).optional().default(0.1),
        pixels: z.number().int().min(0).optional(),
        index: z.number().int().min(0).optional(),
      }),
    })
    .describe(
      "Scroll vertically. Without index: scrolls the document. With index: scrolls the container at that index (or its nearest scrollable ancestor). Use index of a data-scrollable element to scroll a specific area.",
    ),
  z
    .object({
      scroll_horizontally: z.object({
        right: z.boolean().default(true),
        pixels: z.number().int().min(0),
        index: z.number().int().min(0).optional(),
      }),
    })
    .describe(
      "Scroll horizontally. Without index: scrolls the document. With index: scrolls the container at that index (or its nearest scrollable ancestor). Use index of a data-scrollable element to scroll a specific area.",
    ),
];

const macroSchema = z.object({
  evaluation_previous_goal: z.string().optional(),
  memory: z.string().optional(),
  next_goal: z.string().optional(),
  action: z.union(actionSchemas),
});

export const PAGE_AGENT_TOOL_PARAMETERS = z.toJSONSchema(macroSchema, {
  target: "openapi-3.0",
});

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
