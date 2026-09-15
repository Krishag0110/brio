import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Actor, ControlState } from "../src/control/types";
import { initialState } from "../src/control/seed";
import { runtimeConfig } from "../src/server/config";
import { canonicalJson, DAY, hashText } from "../src/core/domain";
export const config = () => ({ ...runtimeConfig(), mode: "live" as const, convexConfigured: true, accessConfigured: (process.env.CONTROL_SERVICE_SECRET?.length ?? 0) >= 32 });
export async function readState(ctx: Pick<QueryCtx, "db">): Promise<ControlState> {
  const row = await ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique();
  return row?.state as ControlState ?? initialState(config());
}
export async function writeState(ctx: Pick<MutationCtx, "db">, state: ControlState) {
  if (state.workspaceId !== "fde") throw new Error("workspace_mismatch");
  const clean = JSON.parse(JSON.stringify(state));
  if (new TextEncoder().encode(JSON.stringify(clean)).length > 700_000) throw new Error("workspace_capacity_requires_archive");
  const row = await ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique();
  const previousEvents = new Map(((row?.state as ControlState | undefined)?.audit ?? []).map(event => [event.id, event]));
  for (const event of state.audit) {
    const previous = previousEvents.get(event.id);
    if (previous) { if (canonicalJson(previous) !== canonicalJson(event)) throw new Error("audit_event_immutable"); continue; }
    const digest = hashText(canonicalJson(event));
    const existing = await ctx.db.query("auditEvents").withIndex("by_workspace_event", q => q.eq("workspaceId", state.workspaceId).eq("eventId", event.id)).unique();
    if (existing) { if (existing.digest !== digest) throw new Error("audit_event_immutable"); continue; }
    const timestamp = Date.parse(event.at); if (!Number.isFinite(timestamp)) throw new Error("invalid_audit_timestamp");
    await ctx.db.insert("auditEvents", { workspaceId: state.workspaceId, eventId: event.id, at: event.at, actor: event.actor, role: event.role, action: event.action, detail: event.detail, digest, expiresAt: timestamp + 90 * DAY });
  }
  if (row) await ctx.db.replace(row._id, { workspaceId: "fde", state: clean });
  else await ctx.db.insert("controlStates", { workspaceId: "fde", state: clean });
}
export async function authenticatedActor(_ctx: Pick<QueryCtx, "auth" | "db">, _state?: ControlState, serviceKey?: string): Promise<Actor> {
  const expected = process.env.CONTROL_SERVICE_SECRET;
  if (!expected || expected.length < 32 || typeof serviceKey !== "string" || serviceKey.length < 32 || serviceKey.length > 4096) throw new Error("unauthorized");
  const expectedHash = hashText(expected), suppliedHash = hashText(serviceKey);
  let mismatch = 0; for (let i = 0; i < expectedHash.length; i++) mismatch |= expectedHash.charCodeAt(i) ^ suppliedHash.charCodeAt(i);
  if (mismatch !== 0) throw new Error("unauthorized");
  return { id: "hackathon-operator", name: "Hackathon operator", roles: ["engineer", "marketer", "admin"] };
}
export function configuredSlackActor(teamId: string, userId: string): Actor {
  if (!process.env.SLACK_TEAM_ID || teamId !== process.env.SLACK_TEAM_ID) throw new Error("slack_team_not_allowed");
  const roles: Actor["roles"] = [];
  for (const role of ["engineer", "marketer", "admin"] as const) if ((process.env[`SLACK_${role.toUpperCase()}_USER_IDS`] ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(userId)) roles.push(role);
  if (!roles.length) throw new Error("slack_identity_not_bound");
  return { id: `slack:${teamId}:${userId}`, name: userId, roles, slackTeamId: teamId, slackUserId: userId };
}
export const systemActor: Actor = { id: "durable-controller", name: "Durable controller", roles: [] };
