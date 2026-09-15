"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ControlState } from "../src/control/types";
import { ProviderAdapters } from "../src/integrations/providers";
import { providerConfig } from "./execution";
import { publicationEvidenceCase } from "../src/control/reducer";
export const recordManualReceipt = action({ args: { command: v.any(), serviceKey: v.string() }, handler: async (ctx, a): Promise<unknown> => {
  const actor = await ctx.runQuery(internal.control.actorForAction, { serviceKey: a.serviceKey }); if (!actor.roles.includes("marketer")) throw new Error("forbidden");
  if (a.command?.action !== "manual_receipt") throw new Error("invalid_command");
  const state: ControlState = await ctx.runQuery(internal.control.stateForAction, {}), c = state.cases.find(c => c.id === a.command.caseId), p = c?.publications.find(p => p.id === a.command.publicationId);
  if (!c || !p) throw new Error("publication_missing");
  const proof = publicationEvidenceCase(state, c, p);
  let identity;
  if (p.mode === "live" && p.purpose !== "engagement") {
    if (!proof.productionVerified || !proof.candidate || !proof.liveVerifiedAt || Date.now() - proof.liveVerifiedAt > 300_000) throw new Error("fresh_live_evidence_required");
    const providers = new ProviderAdapters(providerConfig()); const current = await providers.vercelProductionIdentity(), deployment = await providers.vercelDeployment(current.deploymentId);
    if (current.deploymentId !== proof.candidate.deploymentId || deployment.meta.headSha !== proof.candidate.headSha || deployment.meta.treeDigest !== proof.candidate.treeDigest || deployment.meta.trustedTestRevision !== proof.testRevision || deployment.meta.buildConfigRevision !== proof.buildConfigRevision || deployment.readyState !== "READY") throw new Error("production_identity_mismatch");
    identity = { deploymentId: current.deploymentId, treeDigest: proof.candidate.treeDigest, checkedAt: Date.now() };
  }
  return ctx.runMutation(internal.control.manualReceipt, { command: a.command, serviceKey: a.serviceKey, ...(identity ? { identity } : {}) });
} });
