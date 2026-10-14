/**
 * What AI calls cost, so each user's spend can be tracked and capped. Prices are US$ per million
 * tokens; $1 per million tokens is exactly one micro-dollar per token, so cost in micro-dollars is
 * tokens × price. Unknown models are charged at the Sonnet rate (never under-counted).
 */
export const AI_MODEL_PRICES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /haiku/i, input: 1, output: 5 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /opus/i, input: 5, output: 25 },
];
const FALLBACK = { input: 3, output: 15 };

/** Cost of one call in micro-dollars (1 = $0.000001), rounded up. */
export function aiCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const p = AI_MODEL_PRICES.find((x) => x.match.test(model)) ?? FALLBACK;
  return Math.ceil(Math.max(0, inputTokens) * p.input + Math.max(0, outputTokens) * p.output);
}

export const microsToUsd = (micros: number) => micros / 1_000_000;

/** Usage-counter metric holding a user's AI spend for a calendar month, in micro-dollars. */
export const AI_COST_METRIC = "ai_cost_micros";
