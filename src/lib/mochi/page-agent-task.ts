export type PageAgentTaskMode = "review" | "fill" | "autopilot";

export interface PageAgentTaskStrategy {
  fields: Record<string, { value: string }>;
}

export const PAGE_AGENT_SYSTEM_INSTRUCTIONS =
  "Act only on the current top-level form. Use the exact provided values and never click buttons; Mochi enforces submission separately. Never guess personal facts or touch credentials, payment, uploads, OTP, or CAPTCHA.";

export function strategyValues(strategy: PageAgentTaskStrategy) {
  return Object.fromEntries(
    Object.entries(strategy.fields)
      .filter(([, suggestion]) => suggestion.value.trim().length > 0)
      .map(([key, suggestion]) => [key, suggestion.value]),
  );
}

export function buildPageAgentTask(
  strategy: PageAgentTaskStrategy,
  mode: PageAgentTaskMode,
) {
  const values = strategyValues(strategy);
  const submitInstruction =
    mode === "autopilot"
      ? "Do not click or submit. Mochi will validate your filled values and invoke one form submission outside the agent."
      : "Do not submit the form, click a final confirmation, or navigate away.";

  return [
    "Fill the single visible form using only the exact field-value map below.",
    "Match keys to labels, names, or accessible descriptions. Skip any field not present.",
    "Never infer or invent a missing value. Do not alter fields outside this map.",
    "Never interact with passwords, passcodes, one-time codes, payment details, file uploads, or CAPTCHA.",
    `Field-value map: ${JSON.stringify(values)}`,
    submitInstruction,
  ].join("\n");
}
