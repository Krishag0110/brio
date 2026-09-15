import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ProviderAdapters, type ProviderConfig } from "../../src/integrations/providers";
import type { BuildRequest } from "../../workers/engineering/coding-runner";
import { REQUIRED_WEATHER_FILES } from "../../workers/engineering/weather-target";

const baseSha = "a".repeat(40), headSha = "b".repeat(40), treeDigest = "c".repeat(40);
const config: ProviderConfig = { slack: { token: "fixture-slack-secret", channel: "C123", teamId: "T123" }, linear: { apiKey: "fixture-linear-secret", teamId: "linear-team" }, github: { dispatchToken: "fixture-dispatch-secret", releaseToken: "fixture-release-secret", repository: "owner/weather", controllerBranch: "main", engineeringGrantSecret: "fixture-only-engineering-grant-secret-32" }, vercel: { token: "fixture-vercel-secret", projectId: "prj_weather", projectName: "weather", productionDomain: "weather.example.com" } };
function stub(responses: unknown[]) {
  const transport = vi.fn(async () => { const value = responses.shift(); return value === undefined ? new Response(null, { status: 204 }) : Response.json(value); });
  return { transport, adapters: new ProviderAdapters(config, transport as typeof fetch), calls: () => transport.mock.calls as unknown as [URL, RequestInit][] };
}
const build: BuildRequest = { jobId: "job", attemptId: "attempt", workspaceId: "workspace", caseId: "case", authorizationRef: "build-ref", authorizationExpiresAt: Date.now() + 600_000, scopeHash: "scope", repository: "owner/weather", baseSha, trustedControllerSha: headSha, allowedPaths: ["lib/temperature.ts"], approvedPlan: "Fix unit conversion", acceptanceCriteria: ["20 C becomes 68 F"], linearUrl: "https://linear.app/team/issue/WTH-1", buildConfigRevision: "config-v1" };

describe("external adapter protocol tests with fixture HTTP", () => {
  it("stages exact committed build files from the separate weather repository root", async () => {
    const entries = REQUIRED_WEATHER_FILES.map((path, index) => ({ path, type: "blob", mode: "100644", size: 10, sha: String(index + 1).repeat(40) }));
    const { adapters, calls } = stub([{ sha: headSha, commit: { tree: { sha: treeDigest } } }, { truncated: false, tree: [...entries, { path: ".env.local", type: "blob", mode: "100644", sha: "9".repeat(40) }, { path: "controller/package.json", type: "blob", mode: "100644", sha: "8".repeat(40) }] }, ...entries.map(entry => ({ sha: entry.sha, encoding: "base64", content: Buffer.from(entry.path).toString("base64"), size: 10 }))]);
    const files = await adapters.githubCommittedWeatherFiles(headSha, treeDigest);
    expect(files.map(file => file.file)).toEqual([...REQUIRED_WEATHER_FILES]);
    expect(calls()[1][0].pathname).toBe(`/repos/owner/weather/git/trees/${treeDigest}`);
    expect(calls()).toHaveLength(2 + entries.length);
  });
  it("missing providers fail before any network call", async () => {
    const transport = vi.fn(), adapters = new ProviderAdapters({}, transport);
    await expect(adapters.linearFindCase("case")).rejects.toThrow("configuration_required:linear");
    await expect(adapters.githubDispatchCoding({ build })).rejects.toThrow("configuration_required:github");
    await expect(adapters.vercelProductionIdentity()).rejects.toThrow("configuration_required:vercel"); expect(transport).not.toHaveBeenCalled();
  });
  it("Slack cards bind exact authority and use plain customer text", async () => {
    const { adapters, calls } = stub([{ ok: true, channel: "C123", ts: "123.456" }]);
    const receipt = await adapters.slackPostApproval({ caseId: "case", authorityId: "approval-v2", kind: "candidate_go", bindingHash: "exact-hash", title: "Review candidate", summary: "Exact reply: bruh", appUrl: "https://control.example/cases/case", expiresAt: Date.now() + 60_000 });
    expect(receipt).toMatchObject({ channel: "C123", ts: "123.456", authorityId: "approval-v2" });
    const [url, init] = calls()[0], payload = JSON.parse(String(init.body));
    expect(url.href).toBe("https://slack.com/api/chat.postMessage"); expect(payload.blocks[1].text.type).toBe("plain_text");
    expect(JSON.parse(payload.blocks[3].elements[0].value)).toEqual({ authorityId: "approval-v2", caseId: "case", bindingHash: "exact-hash", action: "go" });
    expect(payload.unfurl_links).toBe(false); expect(payload).not.toHaveProperty("token");
  });
  it("Slack rejects an HTTP-200 application error without exposing its body", async () => {
    const { adapters } = stub([{ ok: false, error: "fixture-slack-secret" }]);
    await expect(adapters.slackPostStatus({ text: "status", threadTs: "123", caseId: "case" })).rejects.toThrow("slack_operation_rejected");
  });
  it("Linear reconciles an existing case marker before issue creation", async () => {
    const issue = { id: "issue", identifier: "WTH-1", url: "https://linear.app/t/issue/WTH-1" }, { adapters, calls } = stub([{ data: { issues: { nodes: [issue] } } }]);
    expect(await adapters.linearCreateIssue({ caseId: "case", title: "Bug", description: "Reproduced" })).toEqual({ ...issue, reconciled: true }); expect(calls()).toHaveLength(1);
    expect(JSON.parse(String(calls()[0][1].body)).variables.marker).toBe("[fde-case:case]");
  });
  it("Linear creation includes canonical correlation and returns only a verified issue", async () => {
    const issue = { id: "issue", identifier: "WTH-1", url: "https://linear.app/t/issue/WTH-1" }, { adapters, calls } = stub([{ data: { issues: { nodes: [] } } }, { data: { issueCreate: { success: true, issue } } }]);
    expect(await adapters.linearCreateIssue({ caseId: "case", title: "Bug", description: "20°F observed" })).toEqual({ ...issue, reconciled: false });
    expect(JSON.parse(String(calls()[1][1].body)).variables.input.description).toBe("[fde-case:case]\n\n20°F observed");
  });
  it("GitHub dispatch sends a bound signed Build and does not invent a run receipt", async () => {
    const { adapters, calls } = stub([]), result = await adapters.githubDispatchCoding({ build });
    expect(result).toMatchObject({ status: "dispatched", correlation: "job", runReceipt: null });
    const payload = JSON.parse(String(calls()[0][1].body)); expect(payload.ref).toBe("main");
    const encoded = payload.inputs.build_request_base64;
    expect(JSON.parse(Buffer.from(encoded, "base64").toString())).toEqual(build);
    expect(payload.inputs.build_request_signature).toBe(createHmac("sha256", config.github!.engineeringGrantSecret).update(encoded).digest("hex"));
  });
  it("GitHub refuses stale Build and repository changes", async () => {
    const { adapters, transport } = stub([]);
    await expect(adapters.githubDispatchCoding({ build: { ...build, authorizationExpiresAt: 1 } })).rejects.toThrow();
    await expect(adapters.githubDispatchCoding({ build: { ...build, repository: "other/repo" } })).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
  it("GitHub checks are tied to exact candidate SHA and required check names", async () => {
    const { adapters } = stub([{ head: { sha: headSha }, base: { sha: baseSha }, state: "open", merged: false, html_url: "https://github.com/owner/weather/pull/1" }, { sha: headSha, commit: { tree: { sha: treeDigest } } }, { total_count: 1, check_runs: [{ name: "Protected weather", head_sha: headSha, status: "completed", conclusion: "success", details_url: null }] }]);
    expect(await adapters.githubInspectCandidate({ repository: "owner/weather", pullNumber: 1, expectedBaseSha: baseSha, expectedHeadSha: headSha, requiredChecks: ["Protected weather"] })).toMatchObject({ treeDigest, headSha, checksPassed: true });
  });
  it("GitHub fails when a green check belongs to another SHA", async () => {
    const { adapters } = stub([{ head: { sha: headSha }, base: { sha: baseSha }, state: "open", merged: false, html_url: "https://github.com/owner/weather/pull/1" }, { sha: headSha, commit: { tree: { sha: treeDigest } } }, { total_count: 1, check_runs: [{ name: "Protected weather", head_sha: baseSha, status: "completed", conclusion: "success", details_url: null }] }]);
    await expect(adapters.githubInspectCandidate({ repository: "owner/weather", pullNumber: 1, expectedBaseSha: baseSha, expectedHeadSha: headSha, requiredChecks: ["Protected weather"] })).rejects.toThrow("required_check_incomplete");
  });
  it("staging fails before deployment when auto-assignment is on", async () => {
    const { adapters, calls } = stub([{ id: "prj_weather", autoAssignCustomDomains: true }]);
    await expect(adapters.vercelVerifyStagingConfiguration()).rejects.toThrow("production_auto_assignment"); expect(calls()).toHaveLength(1);
  });
  it("staging rejects a Vercel project configured for a nested app", async () => {
    const { adapters, calls } = stub([{ id: "prj_weather", autoAssignCustomDomains: false, rootDirectory: "nested-app" }]);
    await expect(adapters.vercelVerifyStagingConfiguration()).rejects.toThrow("separate_weather_project_root_required"); expect(calls()).toHaveLength(1);
  });
  it("staging rejects any unrelated project credential configuration", async () => {
    const { adapters } = stub([{ id: "prj_weather", autoAssignCustomDomains: false }, { envs: [{ key: "SOCIAL_CALLBACK_SECRET", value: "must-not-be-returned" }] }]);
    await expect(adapters.vercelVerifyStagingConfiguration()).rejects.toThrow("weather_project_must_contain_only_public_identity");
  });
  it("staging creates a production candidate with no aliases and public identity only", async () => {
    const { adapters, calls } = stub([{ id: "prj_weather", autoAssignCustomDomains: false }, { envs: [] }, { projectId: "prj_weather", deploymentId: "dpl_previous" }, { id: "dpl_candidate", url: "candidate.vercel.app", readyState: "BUILDING" }]);
    const result = await adapters.vercelCreateStaged({ files: [{ file: "app/page.tsx", data: "export default function Page(){return null}", encoding: "utf-8" }], metadata: { runId: "run", candidateId: "candidate", headSha, treeDigest, trustedTestRevision: "test-v1", buildConfigRevision: "config-v1" } });
    expect(result).toMatchObject({ status: "staging", previousDeploymentId: "dpl_previous" });
    const payload = JSON.parse(String(calls()[3][1].body)); expect(payload.target).toBe("production"); expect(payload.projectSettings).toMatchObject({ rootDirectory: ".", installCommand: "bunx bun@1.4.2 install --frozen-lockfile --ignore-scripts", buildCommand: "bunx bun@1.4.2 run build" }); expect(payload.alias).toEqual([]); expect(payload.env.WEATHER_HEAD_SHA).toBe(headSha); expect(JSON.stringify(payload)).not.toContain("fixture-vercel-secret");
  });
  it("promotes only a ready bound production deployment and reports pending verification", async () => {
    const binding = { deploymentId: "dpl_candidate", candidateId: "candidate", headSha, treeDigest, trustedTestRevision: "test-v1", buildConfigRevision: "config-v1" };
    const meta = { candidateId: binding.candidateId, headSha, treeDigest, trustedTestRevision: binding.trustedTestRevision, buildConfigRevision: binding.buildConfigRevision };
    const { adapters, calls } = stub([{ id: "dpl_candidate", projectId: "prj_weather", url: "candidate.vercel.app", target: "production", readyState: "READY", meta }, { projectId: "prj_weather", deploymentId: "dpl_previous" }, undefined]);
    expect(await adapters.vercelPromoteExact(binding)).toMatchObject({ status: "promotion_requested", deploymentId: "dpl_candidate", previousDeploymentId: "dpl_previous" });
    expect(calls()[2][0].pathname).toBe("/v10/projects/prj_weather/promote/dpl_candidate"); expect(calls()[2][1].body).toBeUndefined();
  });
  it("refuses preview rebuild promotion and cross-project identities", async () => {
    const binding = { deploymentId: "dpl_candidate", candidateId: "candidate", headSha, treeDigest, trustedTestRevision: "test-v1", buildConfigRevision: "config-v1" };
    const { adapters, calls } = stub([{ id: "dpl_candidate", projectId: "prj_weather", url: "candidate.vercel.app", target: "preview", readyState: "READY", meta: {} }]);
    await expect(adapters.vercelPromoteExact(binding)).rejects.toThrow("exact_staged_production"); expect(calls()).toHaveLength(1);
    const other = stub([{ projectId: "prj_other", deploymentId: "dpl_other" }]); await expect(other.adapters.vercelProductionIdentity()).rejects.toThrow("production_identity_unverified");
  });
});
