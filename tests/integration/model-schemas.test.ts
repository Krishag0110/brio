import { describe, expect, it } from "vitest";
import { z } from "zod";
import { domainClassification, ModelClassificationSchema, modelFailureCode } from "../../src/server/model-schemas";

describe("strict model output schemas and safe diagnostics", () => {
  it("requires all triage properties while using nullable engagementCategory for factual reports", () => {
    const schema = z.toJSONSchema(ModelClassificationSchema);
    expect(schema.required).toEqual(Object.keys(schema.properties!)); expect(schema.additionalProperties).toBe(false);
    const raw = { category: "actionable_defect", confidence: .99, language: "en", riskFlags: [], evidence: ["20°C shown as 20°F"], engagementCategory: null };
    const modeled = ModelClassificationSchema.parse(raw), classified = domainClassification(modeled);
    expect(classified.category).toBe("actionable_defect"); expect(classified).not.toHaveProperty("engagementCategory");
    expect(() => ModelClassificationSchema.parse({ ...raw, engagementCategory: undefined })).toThrow();
    expect(domainClassification(ModelClassificationSchema.parse({ ...raw, category: "low_risk_engagement", engagementCategory: "praise" })).engagementCategory).toBe("praise");
  });
  it("never exposes raw provider messages, bodies, or credentials in failure codes", () => {
    expect(modelFailureCode({ name: "AI_APICallError", statusCode: 400, message: "secret raw request", responseBody: "private user data" })).toBe("model_request_rejected_400");
    expect(modelFailureCode({ name: "AI_NoObjectGeneratedError", cause: { statusCode: 429, headers: { Authorization: "private" } } })).toBe("model_rate_limited");
    expect(modelFailureCode(new Error("private secret"))).toBe("model_generation_failed_or_usage_unknown");
  });
});
