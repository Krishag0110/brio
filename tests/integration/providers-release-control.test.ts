import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { initialState } from "../../src/control/seed";
import { applyCommand, bindingPayload } from "../../src/control/reducer";
import { approvalBinding, createApprovalRequest, decideApproval } from "../../src/core/approvals";
import type { Actor, ControlState, RuntimeConfig } from "../../src/control/types";
import type { ReleaseCandidate } from "../../workers/engineering/release";

const modules = { "../../convex/releaseControl.ts": () => import("../../convex/releaseControl"), "../../convex/_generated/server.js": () => import("../../convex/_generated/server.js") };
const ref = (name: string) => makeFunctionReference<"mutation", Record<string, unknown>, unknown>(`releaseControl:${name}`);
const config: RuntimeConfig = { mode: "demo", repository: "owner/weather", baseSha: "a".repeat(40), openaiConfigured: false, accessConfigured: false, convexConfigured: false, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
const engineer: Actor = { id: "engineer", name: "Engineer", roles: ["engineer"] }, marketer: Actor = { id: "marketer", name: "Marketer", roles: ["marketer"] };
async function fixture() {
  const now = Date.now() - 1000;
  let state = initialState(config);
  state = applyCommand(state, { action: "intake", platform: "x", mode: "fixture", sourceUrl: "https://x.com/customer/status/123", text: "20°C becomes 20°F" }, marketer, config, now);
  state = applyCommand(state, { action: "demo_advance", caseId: state.cases[0].id }, engineer, config, now + 1);
  state = applyCommand(state, { action: "demo_decide", approvalId: state.authorities.find(item => item.request.kind === "build")!.request.requestId, decision: "approved" }, engineer, config, now + 2);
  state = applyCommand(state, { action: "demo_advance", caseId: state.cases[0].id }, engineer, config, now + 3);
  const c = state.cases[0]; c.sourceMode = "manual"; c.candidate = { headSha: "b".repeat(40), treeDigest: "c".repeat(40), deploymentId: "dpl_candidate", productionUrl: "https://candidate.vercel.app", checksPassed: true }; c.testRevision = "weather-protected-v1"; c.buildConfigRevision = "config-v1";
  const authority = state.authorities.findLast(item => item.request.kind === "candidate_go")!;
  for (const publication of c.publications) { publication.mode = "live"; publication.authorityId = "approved-go"; publication.authorityKind = "candidate_go"; }
  authority.payload = bindingPayload(state, authority);
  authority.request = createApprovalRequest({ requestId: "approved-go", workspaceId: state.workspaceId, kind: "candidate_go", version: c.version, payload: authority.payload, now });
  authority.request = decideApproval(authority.request, { currentRequestId: "approved-go", expectedVersion: c.version, expectedBinding: approvalBinding("candidate_go", authority.payload), actor: { workspaceId: state.workspaceId, userId: marketer.id, roles: marketer.roles, active: true }, decision: "approved", now: now + 4 }).request;
  state.mode = "live";
  const connection = state.connections.find(item => item.platform === "x")!; connection.account = c.publications[0].account; connection.paused = false;
  state.tasks = [{ id: "release-task", caseId: c.id, kind: "release_candidate", status: "running", payload: { authorityId: "approved-go" }, attemptId: "attempt", inputRevision: c.version, createdAt: now }];
  const candidate: ReleaseCandidate = { candidateId: "candidate", repository: c.repository, pullNumber: 1, baseSha: c.baseSha, headSha: c.candidate.headSha, treeDigest: c.candidate.treeDigest, trustedTestRevision: c.testRevision, buildConfigRevision: c.buildConfigRevision, deploymentId: c.candidate.deploymentId, deploymentUrl: c.candidate.productionUrl!, productionDomain: "weather.example.com", projectId: "prj_weather", goRef: "approved-go", goExpiresAt: authority.request.grantExpiresAt!, replyBatchHash: "batch" };
  const t = convexTest(schema, modules);
  await t.run(async ctx => { await ctx.db.insert("controlStates", { workspaceId: "fde", state: JSON.parse(JSON.stringify(state)) }); });
  const mutateState = async (change: (state: ControlState) => void) => t.run(async ctx => { const row = (await ctx.db.query("controlStates").collect())[0]; const s = row.state as ControlState; change(s); await ctx.db.patch(row._id, { state: JSON.parse(JSON.stringify(s)) }); });
  return { t, candidate, state, mutateState, args: { taskId: "release-task", attemptId: "attempt", candidate } };
}
describe("Convex durable release authority", () => {
  it("authorizes audited local operator rollback without a legacy web membership", async () => {
    const { t, mutateState } = await fixture();
    await mutateState(state => {
      state.cases[0].previousDeploymentId = "dpl_previous";
      state.tasks[0].kind = "rollback_deployment";
      state.tasks[0].payload = { operatorId: "hackathon-operator", operatorRole: "engineer", operatorAuthorizationRef: "rollback-authority", previousDeploymentId: "dpl_previous", requestedAt: Date.now() };
    });
    const input = { taskId: "release-task", attemptId: "attempt" };
    expect(await t.mutation(ref("authorizeTask"), input)).toEqual({ allowed: true });
    await mutateState(state => { state.tasks[0].payload.operatorId = "untrusted-user"; });
    await expect(t.mutation(ref("acquireRollback"), { ...input, projectId: "prj_weather" })).rejects.toThrow("current_rollback_operator_authorization_required");
  });
  it.each([
    { operatorId: "hackathon-operator", operatorRole: "marketer", requestedAt: Date.now() },
    { operatorId: "forged-operator", operatorRole: "admin", requestedAt: Date.now() },
    { operatorId: "hackathon-operator", operatorRole: "admin", requestedAt: Date.now() - 3_700_000 },
    { operatorId: "hackathon-operator", operatorRole: "engineer", requestedAt: Date.now() + 3_700_000 },
  ])("rejects forged role, actor or expired rollback authority %j", async overrides => {
    const { t, mutateState } = await fixture();
    await mutateState(state => {
      state.cases[0].previousDeploymentId = "dpl_previous"; state.tasks[0].kind = "rollback_deployment";
      state.tasks[0].payload = { operatorAuthorizationRef: "rollback-authority", previousDeploymentId: "dpl_previous", ...overrides };
    });
    const input = { taskId: "release-task", attemptId: "attempt" };
    await expect(t.mutation(ref("authorizeTask"), input)).rejects.toThrow("current_rollback_operator_authorization_required");
    await expect(t.mutation(ref("acquireRollback"), { ...input, projectId: "prj_weather" })).rejects.toThrow("current_rollback_operator_authorization_required");
  });
  it("persists a single lock, rejects concurrent acquire, and resumes the exact recorded merge", async () => {
    const { t, args } = await fixture();
    const acquired = await t.mutation(ref("acquire"), args) as { lockId: string };
    await expect(t.mutation(ref("acquire"), args)).rejects.toThrow("release_busy");
    await t.mutation(ref("save"), { lockId: acquired.lockId, state: { candidateId: "candidate", stage: "merged", previousDeploymentId: "dpl_previous", mergeSha: "d".repeat(40) } });
    await t.mutation(ref("release"), { lockId: acquired.lockId });
    const resumed = await t.mutation(ref("acquire"), args) as { lockId: string; state: { stage: string } };
    expect(resumed.state.stage).toBe("merged"); expect(resumed.lockId).not.toBe(acquired.lockId);
  });
  it("revocation or exact-reply drift blocks the next effect after lock acquisition", async () => {
    const { t, args, candidate, mutateState } = await fixture(); const { lockId } = await t.mutation(ref("acquire"), args) as { lockId: string };
    await mutateState(state => { state.authorities.find(item => item.request.requestId === candidate.goRef)!.request.status = "revoked"; });
    await expect(t.mutation(ref("authorize"), { ...args, lockId, effect: "promote" })).rejects.toThrow("approval_inactive");
  });
  it("fixture candidates and stale attempts cannot acquire live release authority", async () => {
    const { t, args, mutateState } = await fixture();
    await expect(t.mutation(ref("acquire"), { ...args, attemptId: "stale" })).rejects.toThrow("stale_engineering_attempt");
    await mutateState(state => { state.cases[0].sourceMode = "fixture"; }); await expect(t.mutation(ref("acquire"), args)).rejects.toThrow("fixture_live_mismatch");
  });
  it("failed live verification pauses subsequent releases and persists the block", async () => {
    const { t, args } = await fixture(); const { lockId } = await t.mutation(ref("acquire"), args) as { lockId: string };
    await t.mutation(ref("release"), { lockId, blockedReason: "live_verification_failed" });
    await expect(t.mutation(ref("acquire"), args)).rejects.toThrow("workspace_paused");
    const row = await t.run(ctx => ctx.db.query("releaseLocks").first()); expect(row?.blockedReason).toBe("live_verification_failed");
  });
});
