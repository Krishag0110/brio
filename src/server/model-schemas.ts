import { z } from "zod";
import { ClassificationSchema, type Classification } from "../core/signals";

// Strict Structured Outputs requires every property; null represents an absent category.
// https://developers.openai.com/api/docs/guides/structured-outputs
export const ModelClassificationSchema = ClassificationSchema.extend({ engagementCategory: ClassificationSchema.shape.engagementCategory.unwrap().nullable() }).strict();
export function domainClassification(value: z.infer<typeof ModelClassificationSchema>): Classification {
  const { engagementCategory, ...rest } = value;
  return ClassificationSchema.parse({ ...rest, ...(engagementCategory === null ? {} : { engagementCategory }) });
}
/** Expose fixed categories, never provider messages, bodies or request headers. */
export function modelFailureCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const value = current as { name?: unknown; statusCode?: unknown; cause?: unknown };
    if (value.statusCode === 400) return "model_request_rejected_400";
    if (value.statusCode === 401 || value.statusCode === 403) return "model_credentials_rejected";
    if (value.statusCode === 429) return "model_rate_limited";
    if (typeof value.statusCode === "number" && value.statusCode >= 500) return "model_provider_unavailable";
    if (value.name === "AbortError" || value.name === "TimeoutError") return "model_timeout_usage_unknown";
    if (value.cause) { current = value.cause; continue; }
    if (value.name === "AI_NoObjectGeneratedError" || value.name === "AI_TypeValidationError" || value.name === "ZodError") return "model_structured_output_invalid";
    break;
  }
  return "model_generation_failed_or_usage_unknown";
}
