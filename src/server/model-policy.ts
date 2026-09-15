/** Standard gpt-5-mini rates verified from OpenAI model documentation 2026-09-14. */
export const MODEL = "gpt-5-mini" as const;
export const PRICING = { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2, verifiedAt: "2026-09-14", source: "https://developers.openai.com/api/docs/models/gpt-5-mini" };
export function modelReservation(prompt: string, outputTokens: number, schemaBytes = 8000): number {
  // UTF-8 bytes upper-bound token count; include system/schema overhead and no cached-input discount.
  const bytes = new TextEncoder().encode(prompt).length;
  if (bytes > 32_000 || !Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 4096) throw new Error("model_input_or_output_limit");
  return Math.ceil((((bytes + schemaBytes + 4096) * PRICING.inputUsdPerMillion + outputTokens * PRICING.outputUsdPerMillion) / 1_000_000) * 1_000_000) / 1_000_000;
}
export function usageUsd(usage: { inputTokens?: number; outputTokens?: number }): number {
  if (!Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens) || usage.inputTokens! < 0 || usage.outputTokens! < 0) throw new Error("usage_reconciliation_required");
  return Math.ceil((usage.inputTokens! * PRICING.inputUsdPerMillion + usage.outputTokens! * PRICING.outputUsdPerMillion)) / 1_000_000;
}
