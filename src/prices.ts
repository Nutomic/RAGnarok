// Mistral API pricing, EUR per 1M tokens (docs.mistral.ai/inference/pricing,
// checked 2026-10). Used for the per-answer cost in the UI and audit view;
// the Langfuse bootstrap seeds the same table into its models table.
export const MISTRAL_PRICES_PER_M: Record<string, { input: number; output: number }> = {
  "ministral-14b-latest": { input: 0.18, output: 0.18 },
  "mistral-small-latest": { input: 0.12, output: 0.5 },
};

// Throws on unknown models: a missing price must not silently produce 0 cost.
export function costFor(model: string, inputTokens: number, outputTokens: number): number {
  const p = MISTRAL_PRICES_PER_M[model];
  if (!p) throw new Error(`No Mistral price configured for model: ${model}`);
  return (p.input * inputTokens + p.output * outputTokens) / 1e6;
}
