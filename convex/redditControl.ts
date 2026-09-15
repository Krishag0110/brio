import { v } from "convex/values";
import { z } from "zod";
import { internalMutation } from "./_generated/server";
import { authenticatedActor, readState, writeState } from "./state";
import { audit } from "../src/control/reducer";
import { canonicalJson } from "../src/core/domain";
import { grantSchema } from "../workers/shared/contracts";
import { encryptedRedditCredentialSchema, redditAccountSchema, redditCommunitiesSchema } from "../workers/shared/reddit-contracts";

export const create = internalMutation({ args: { accountId: v.string(), serviceKey: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const state = await readState(ctx), actor = await authenticatedActor(ctx, state, args.serviceKey);
  if (!actor.roles.includes("admin")) throw new Error("forbidden");
  if (process.env.REDDIT_API_APPROVED !== "true") throw new Error("reddit_access_pending");
  const accountId = redditAccountSchema.parse(args.accountId);
  const connection = state.connections.find(item => item.platform === "reddit" && redditAccountSchema.safeParse(item.account).data === accountId);
  if (!connection || connection.status === "disabled") throw new Error("configure_account_first");
  for (const pending of await ctx.db.query("redditOAuthStates").withIndex("by_connection", q => q.eq("connectionId", connection.id)).take(10)) await ctx.db.delete(pending._id);
  for (const credential of await ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", connection.id)).take(10)) await ctx.db.delete(credential._id);
  connection.version++; connection.account = accountId; connection.permission = "unverified"; connection.status = "reconnect_required";
  connection.detail = "Reddit authorization started; account identity is awaiting verification.";
  delete connection.cursor; delete connection.lastPolledAt;
  const grant = { schemaVersion: 1 as const, jti: crypto.randomUUID(), workspaceId: state.workspaceId, connectionId: connection.id, connectionVersion: connection.version, accountId, operation: "reddit_oauth" as const, exp: Date.now() + 300_000 };
  await ctx.db.insert("redditOAuthStates", { jti: grant.jti, connectionId: connection.id, grant, phase: "issued", expiresAt: grant.exp });
  await writeState(ctx, state);
  return grant;
} });

/** Reachable only through the worker's HMAC-authenticated HTTP callback. No plaintext token input. */
export const callback = internalMutation({ args: { path: v.string(), data: v.any() }, returns: v.any(), handler: async (ctx, { path, data }) => {
  if (JSON.stringify(data).length > 16_000) throw new Error("payload_too_large");
  const raw = z.record(z.string(), z.unknown()).parse(data);
  const jti = z.string().uuid().parse(raw.state);
  const pending = await ctx.db.query("redditOAuthStates").withIndex("by_jti", q => q.eq("jti", jti)).unique();
  if (!pending) throw new Error("reddit_state_invalid");
  const grant = grantSchema.parse(pending.grant);
  if (grant.operation !== "reddit_oauth") throw new Error("reddit_state_invalid");
  const state = await readState(ctx), connection = state.connections.find(item => item.id === grant.connectionId && item.platform === "reddit");
  if (!connection || connection.version !== grant.connectionVersion || connection.account !== grant.accountId || state.workspaceId !== grant.workspaceId || connection.status === "disabled" || pending.expiresAt <= Date.now()) throw new Error("reddit_state_expired_or_changed");
  if (path === "fail") {
    if (pending.phase !== "claimed") throw new Error("reddit_state_consumed");
    await ctx.db.patch(pending._id, { phase: "failed" });
    connection.status = "reconnect_required"; connection.permission = "unverified"; connection.detail = "Reddit authorization failed. Start a new connection attempt.";
    await writeState(ctx, state); return { rejected: true };
  }
  if (process.env.REDDIT_API_APPROVED !== "true") throw new Error("reddit_access_pending");
  if (path === "start") {
    if (pending.phase !== "issued" || canonicalJson(raw.grant) !== canonicalJson(grant)) throw new Error("reddit_state_consumed");
    const browserHash = z.string().regex(/^[a-f0-9]{64}$/).parse(raw.browserHash);
    await ctx.db.patch(pending._id, { phase: "started", browserHash }); return { started: true };
  }
  if (path === "claim") {
    if (pending.phase !== "started" || typeof raw.browserHash !== "string" || raw.browserHash !== pending.browserHash) throw new Error("reddit_state_or_browser_mismatch");
    await ctx.db.patch(pending._id, { phase: "claimed" }); return { grant };
  }
  if (path !== "activate" || pending.phase !== "claimed") throw new Error("reddit_state_consumed");
  if (raw.verifiedAccountId !== grant.accountId) throw new Error("reddit_account_mismatch");
  const encrypted = encryptedRedditCredentialSchema.parse(raw.encrypted), allowedSubreddits = redditCommunitiesSchema.parse(raw.allowedSubreddits);
  for (const field of ["workspaceId", "accountId", "connectionId", "connectionVersion"] as const) if (encrypted[field] !== grant[field]) throw new Error("reddit_credential_binding_mismatch");
  if (JSON.stringify(encrypted).length > 12_000) throw new Error("payload_too_large");
  const existing = await ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", connection.id)).unique();
  if (existing) await ctx.db.delete(existing._id);
  await ctx.db.insert("redditCredentials", { connectionId: connection.id, connectionVersion: connection.version, encrypted, allowedSubreddits, verifiedAt: Date.now() });
  await ctx.db.patch(pending._id, { phase: "activated" });
  connection.permission = "granted"; connection.status = "ready"; connection.lastCheckedAt = new Date().toISOString();
  connection.cursor = String(Date.now()); connection.lastPolledAt = Date.now();
  connection.detail = "Reddit identity and OAuth scopes verified for the current connection. Approved communities are enforced; reply approval is still required.";
  audit(state, { id: "social-worker", name: "Social worker", roles: [] }, "reddit_account_verified", "Worker verified the account and stored an encrypted, version-bound OAuth credential.", Date.now());
  await writeState(ctx, state); return { activated: true };
} });
