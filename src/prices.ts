// Mistral API pricing, EUR per 1M tokens (docs.mistral.ai/inference/pricing,
// checked 2026-10). Used for the per-answer cost in the UI and audit view;
// the Langfuse bootstrap seeds the same table into its models table.
export const MISTRAL_PRICES_PER_M: Record<string, { input: number; output: number }> = {
  "ministral-14b-latest": { input: 0.18, output: 0.18 },
  "mistral-small-latest": { input: 0.12, output: 0.5 },
};

export function costFor(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = model ? MISTRAL_PRICES_PER_M[model] : undefined;
  return p ? (p.input * inputTokens + p.output * outputTokens) / 1e6 : null;
}
