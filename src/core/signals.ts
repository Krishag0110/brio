import { z } from "zod";
import { canonicalJson, PlatformSchema, SourceModeSchema, type Platform, type Route } from "./domain";

export function parseSocialTarget(platform: Platform, originalUrl: string): { interactionId: string; canonicalUrl: string } | null {
  try {
    const url = new URL(originalUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (platform === "x") {
      if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/)?$/);
      return match ? { interactionId: match[2], canonicalUrl: `https://x.com/${match[1]}/status/${match[2]}` } : null;
    }
    if (!["reddit.com", "www.reddit.com", "old.reddit.com"].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/(?:r\/[A-Za-z0-9_]+\/)?comments\/([a-z0-9]+)(?:\/[^/]+)?(?:\/([a-z0-9]+))?\/?$/i);
    if (!match) return null;
    return { interactionId: `${match[2] ? "t1" : "t3"}_${(match[2] ?? match[1]).toLowerCase()}`, canonicalUrl: `https://www.reddit.com${url.pathname.replace(/\/$/, "")}/` };
  } catch { return null; }
}
export const SignalInputSchema = z.object({
  workspaceId: z.string().min(1), platform: PlatformSchema, sourceMode: SourceModeSchema,
  externalInteractionId: z.string().min(1).optional(), originalUrl: z.string().default(""),
  authorId: z.string().min(1), text: z.string().min(1).max(20_000), observedAt: z.number().finite(),
  productId: z.string().min(1), deployedRevision: z.string().optional(), component: z.string().optional(),
  symptomSignature: z.string().optional(), fixtureNamespace: z.string().min(1).optional(), localId: z.string().min(1).optional(),
}).strict();
export type SignalInput = z.input<typeof SignalInputSchema>;
export type NormalizedSignal = z.output<typeof SignalInputSchema> & {
  interactionId: string; sourceKey: string; normalizedUrl: string | null; hasValidTarget: boolean;
};
/** Source text is retained verbatim as untrusted evidence. A fixture always uses a distinct key. */
export function normalizeSignal(value: SignalInput): NormalizedSignal {
  const input = SignalInputSchema.parse(value);
  const target = parseSocialTarget(input.platform, input.originalUrl);
  if (input.sourceMode === "fixture" && !input.fixtureNamespace) throw new Error("fixture_namespace_required");
  if (input.sourceMode !== "fixture" && input.externalInteractionId && target && input.externalInteractionId !== target.interactionId) throw new Error("source_id_url_mismatch");
  const interactionId = target?.interactionId ?? input.externalInteractionId ?? input.localId;
  if (!interactionId) throw new Error("internal_signal_requires_local_id");
  const namespace = input.sourceMode === "fixture" ? `fixture:${input.fixtureNamespace}` : "real";
  return { ...input, interactionId, sourceKey: canonicalJson([input.workspaceId, input.platform, namespace, interactionId]),
    normalizedUrl: target?.canonicalUrl ?? null, hasValidTarget: target !== null && input.sourceMode !== "fixture" };
}
export interface ReportSignature {
  productId: string; deployedRevision?: string; component?: string; symptomSignature?: string;
}
export function canGroupReports(a: ReportSignature, b: ReportSignature): boolean {
  return Boolean(a.productId && a.deployedRevision && a.component && a.symptomSignature &&
    a.productId === b.productId && a.deployedRevision === b.deployedRevision && a.component === b.component && a.symptomSignature === b.symptomSignature);
}

export const ClassificationSchema = z.object({
  category: z.enum(["actionable_defect", "potential_known_remedy", "support_needs_information", "low_risk_engagement", "feature_request", "irrelevant_harmful_spam"]),
  confidence: z.number().min(0).max(1),
  riskFlags: z.array(z.string()), evidence: z.array(z.string()),
  language: z.string().min(1), engagementCategory: z.enum(["friendly_banter", "praise", "harmless_joke", "mild_repetition", "light_roast"]).optional(),
});
export type Classification = z.infer<typeof ClassificationSchema>;
export function isOptOut(text: string): boolean {
  return /\b(stop (?:replying|responding|messaging|contacting)|do not (?:reply|respond|contact)|don['’]?t (?:reply|respond|contact)|leave me alone|unsubscribe|opt[ -]?out|no more replies)\b/i.test(text);
}

/** Deterministic fixture/fallback triage. Live autonomous classification still requires the independent model step. */
export function classifySignal(text: string): Classification {
  const result = (category: Classification["category"], riskFlags: string[], confidence = 0.95, engagementCategory?: Classification["engagementCategory"]): Classification =>
    ({ category, confidence, riskFlags, language: "en", evidence: [text.slice(0, 400)], ...(engagementCategory ? { engagementCategory } : {}) });
  if (isOptOut(text)) return result("irrelevant_harmful_spam", ["opt_out"]);
  if (/\b(ignore (?:all |your |previous |the )?(?:policy|instructions|rules)|reveal (?:cookies|secrets|tokens)|system prompt|act as (?:system|developer))\b/i.test(text)) return result("support_needs_information", ["prompt_injection"]);
  if (/\b(crypto|airdrop|guaranteed returns|click to win|buy followers|free bitcoin)\b|(?:https?:\/\/\S+.*){3}/i.test(text) || /\b(\w+)(?:[\s,!]+\1){10,}\b/i.test(text)) return result("irrelevant_harmful_spam", ["scam_or_commercial_spam"]);
  if (/\b(lost money|cost me money|refund|compensation|suicid\w*|kill myself|kill yourself|self.harm|panic attack|hospital|injur\w*|security|hacked|data leak|password|stalker|threat\w*|hurt (?:you|myself)|nudes?|sexual|your (?:race|religion|disability)|you (?:are|look) (?:ugly|worthless|fat)|guarantee (?:the|my|your)|promise.*tomorrow)\b/i.test(text)) return result("support_needs_information", ["sensitive_context"]);
  if (/\b(crash\w*|broken|doesn['’]?t work|not working|can['’]?t (?:load|login|log in|open)|fails? to|bug|wrong (?:temperature|unit|forecast)|20\s*°?c.*20\s*°?f|error|freez(?:es|ing))\b/i.test(text)) return result("actionable_defect", ["genuine_complaint"]);
  if (/\b(maybe|not sure|sort of|weird|something (?:is |seems )?off|is that normal|sarcasm|angry|furious|useless|garbage|terrible|hate|ridiculous|wtf)\b/i.test(text)) return result("support_needs_information", ["ambiguous_or_angry"], 0.65);
  if (/\b(please add|feature request|wish (?:you|it)|could you add|dark mode when)\b/i.test(text)) return result("feature_request", ["product_request"]);
  if (/[^\u0000-\u007F\u00B0\u2018-\u201F\u2600-\u27BF\uD800-\uDFFF]/.test(text)) return { ...result("support_needs_information", ["unsupported_language"], 0.6), language: "und" };
  if (/\broast me\b/i.test(text)) return result("low_risk_engagement", [], 0.96, "light_roast");
  if (/\brefresh(?:[ ,]+refresh){2,}\b/i.test(text)) return result("low_risk_engagement", [], 0.95, "mild_repetition");
  if (/\b(love|thanks|thank you|great|awesome|beautiful|best|drip|nice|helpful|appreciate)\b/i.test(text)) return result("low_risk_engagement", [], 0.97, "praise");
  if (/\b(bruh|outside exists|weather|forecasts?|clouds?|sun|rain|umbrellas?|vibes|sky|weekend|wind|snow|temperature|refresh)\b/i.test(text)) return result("low_risk_engagement", [], 0.94, "friendly_banter");
  return result("support_needs_information", ["uncertain_intent"], 0.5);
}
export function routeForClassification(classification: Classification): Route | null {
  if (classification.category === "actionable_defect") return "engineering_resolution";
  if (classification.category === "potential_known_remedy") return "known_remedy";
  if (classification.category === "low_risk_engagement") return "social_engagement";
  return null;
}

export interface SolvedIssue {
  id: string; fictional: boolean; symptomSignature: string; component: string; affectedRevision: string;
  remedy: string; remedyType: "fix" | "workaround" | "instructions"; verificationNotes: string; valid: boolean;
}
export const FICTIONAL_SOLVED_ISSUES: readonly SolvedIssue[] = [
  ["unit-label", "temperature-display", "Unit toggled without conversion", "Use Celsius until conversion is verified", "workaround"],
  ["rounding", "temperature-display", "Fractional values rounded too early", "Round only the final display value", "fix"],
  ["default-unit", "preferences", "Reload returns to a different unit", "Choose Celsius after reload", "workaround"],
  ["stale-fixture", "forecast-data", "Stale sample forecast remains visible", "Reload the deterministic sample dataset", "instructions"],
  ["empty-location", "location-picker", "No location selected", "Select the sample city", "instructions"],
  ["negative-sign", "temperature-display", "Minus sign omitted", "Preserve the negative sign when formatting", "fix"],
  ["keyboard-toggle", "unit-control", "Space does not toggle units", "Use the on-screen unit button", "workaround"],
  ["double-toggle", "unit-control", "Rapid toggles desynchronize label", "Derive value and unit from one state", "fix"],
  ["forecast-width", "layout", "Forecast card overflows narrow screen", "Use the compact card layout", "fix"],
  ["loading-label", "status", "Loading label persists over fixture", "Reload and select the fixture again", "workaround"],
].map(([id, component, symptomSignature, remedy, remedyType]) => ({ id: `fictional-${id}`, fictional: true, symptomSignature, component,
  affectedRevision: "fictional-v0", remedy, remedyType: remedyType as SolvedIssue["remedyType"], verificationNotes: "Fictional demonstration seed. Current independent verification required.", valid: false }));

export function matchSolvedIssues(issues: readonly SolvedIssue[], component: string, query: string): SolvedIssue[] {
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  return issues.filter((issue) => issue.component === component && words.some((word) => `${issue.symptomSignature} ${issue.remedy}`.toLowerCase().includes(word)));
}
