"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { signGrant, requireSecret } from "../workers/shared/security";
export const createImportGrant = action({ args: { accountId: v.string(), serviceKey: v.string() }, handler: async (ctx, a): Promise<{ grant: string }> => {
  const grant = await ctx.runMutation(internal.workerControl.createImport, a);
  return { grant: signGrant(grant, requireSecret(process.env.SOCIAL_GRANT_SECRET, "SOCIAL_GRANT_SECRET")) };
} });
export const createRedditGrant = action({ args: { accountId: v.string(), serviceKey: v.string() }, returns: v.object({ grant: v.string() }), handler: async (ctx, args): Promise<{ grant: string }> => {
  const grant = await ctx.runMutation(internal.redditControl.create, args);
  return { grant: signGrant(grant, requireSecret(process.env.SOCIAL_GRANT_SECRET, "SOCIAL_GRANT_SECRET")) };
} });
