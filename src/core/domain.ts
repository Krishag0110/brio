import { z } from "zod";

export const RouteSchema = z.enum(["engineering_resolution", "known_remedy", "social_engagement"]);
export type Route = z.infer<typeof RouteSchema>;
export const PlatformSchema = z.enum(["x", "reddit"]);
export type Platform = z.infer<typeof PlatformSchema>;
export const SourceModeSchema = z.enum(["live", "manual", "fixture"]);
export type SourceMode = z.infer<typeof SourceModeSchema>;
export const RoleSchema = z.enum(["engineer", "marketer", "admin"]);
export type Role = z.infer<typeof RoleSchema>;
export const PhaseSchema = z.enum(["RECEIVED", "TRIAGING", "INVESTIGATING", "AWAITING_BUILD", "BUILDING", "VERIFYING_CANDIDATE", "AWAITING_GO", "RELEASING", "VERIFYING_LIVE", "READY_TO_PUBLISH", "PUBLISHING", "AWAITING_MANUAL_CONFIRMATION", "COMPLETED"]);
export type Phase = z.infer<typeof PhaseSchema>;
export const BlockerSchema = z.enum(["needs_evidence", "needs_review", "no_go", "checks_failed", "stale_approval", "deployment_failed", "verification_failed", "reconnect_required", "access_pending", "budget_exhausted", "publication_unknown"]);
export type Blocker = z.infer<typeof BlockerSchema>;
export const OutcomeSchema = z.enum(["fixed_and_notified", "remedy_delivered", "workaround_delivered", "engaged", "ignored", "build_declined", "resolved_without_reply"]);
export type Outcome = z.infer<typeof OutcomeSchema>;
export const PurposeSchema = z.enum(["resolution", "known_fix", "workaround", "instructions", "engagement"]);
export type ReplyPurpose = z.infer<typeof PurposeSchema>;
export const AuthorizationKindSchema = z.enum(["candidate_go", "reply_approval", "persona_policy"]);
export type AuthorizationKind = z.infer<typeof AuthorizationKindSchema>;
export const AppModelSchema = z.literal("gpt-5-mini");
export const APP_MODEL = "gpt-5-mini" as const;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const LIVE_EVIDENCE_MAX_AGE_MS = 5 * MINUTE;

export interface Decision { allowed: boolean; reasons: string[] }
export function decision(reasons: string[]): Decision {
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export const MembershipSchema = z.object({
  workspaceId: z.string().min(1), userId: z.string().min(1), roles: z.array(RoleSchema).min(1),
  slackTeamId: z.string().optional(), slackUserId: z.string().optional(), active: z.boolean(),
});
export type Membership = z.infer<typeof MembershipSchema>;
export function requireRole(member: Membership | null, workspaceId: string, role: Role): void {
  if (!member?.active || member.workspaceId !== workspaceId || !member.roles.includes(role)) {
    throw new Error("forbidden: workspace membership and required role must match");
  }
}
export function requireAnyRole(member: Membership | null, workspaceId: string, roles: Role[]): void {
  if (!member?.active || member.workspaceId !== workspaceId || !roles.some((role) => member.roles.includes(role))) {
    throw new Error("forbidden: workspace membership and permitted role must match");
  }
}

/** Canonical JSON is a binding, never a digest. Persist all bound fields or hash it with SHA-256. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Bindings require finite JSON values; undefined and class instances are forbidden");
}
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Synchronous SHA-256 for pure reducers and Convex mutations (UTF-8 input). */
export function hashText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(size);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(size - 4, (bytes.length * 8) >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = (words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + k[i] + words[i]) >>> 0;
      const t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,hh].forEach((n,i) => { h[i] = (h[i] + n) >>> 0; });
  }
  return h.map((n) => n.toString(16).padStart(8,"0")).join("");
}

export function completionOutcome(input: {
  route: Route; purpose: ReplyPurpose; liveVerified: boolean;
  requiredReplies: number; confirmedReplies: number; communicationWaived: boolean;
}): Outcome | null {
  if (input.communicationWaived) return "resolved_without_reply";
  if (input.requiredReplies < 1 || input.confirmedReplies !== input.requiredReplies) return null;
  if (input.route === "engineering_resolution") return input.liveVerified ? "fixed_and_notified" : null;
  if (input.route === "known_remedy") return input.liveVerified ? (input.purpose === "workaround" ? "workaround_delivered" : "remedy_delivered") : null;
  return "engaged";
}
