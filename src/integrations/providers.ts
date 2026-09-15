import { createHmac } from "node:crypto";
import { z } from "zod";
import { buildRequestSchema, type BuildRequest } from "../../workers/engineering/coding-runner";
import type { ReleaseCandidate } from "../../workers/engineering/release";
import { assertWeatherBuildFiles, isWeatherBuildFile } from "../../workers/engineering/weather-target";

export type ProviderConfig = {
  slack?: { token: string; channel: string; teamId: string };
  linear?: { apiKey: string; teamId: string };
  github?: { dispatchToken: string; readToken?: string; releaseToken?: string; repository: string; controllerRepository?: string; controllerBranch: string; engineeringGrantSecret: string; workflowId?: string };
  vercel?: { token: string; projectId: string; projectName: string; teamId?: string; productionDomain: string };
};
export type ApprovalCard = { caseId: string; authorityId: string; kind: "build" | "candidate_go" | "reply_approval" | "persona_policy"; bindingHash: string; title: string; summary: string; appUrl: string; expiresAt: number; threadTs?: string };
const issueSchema = z.object({ id: z.string(), identifier: z.string(), url: z.string().url() });
const sha = z.string().regex(/^[a-f0-9]{40}$/);

/** Import only from trusted Node/Convex actions. No browser bundle or generated-code dependency. */
export class ProviderAdapters {
  constructor(private readonly config: ProviderConfig, private readonly transport: typeof fetch = fetch) {
    if (typeof window !== "undefined") throw new Error("server_only_provider");
  }
  private require<K extends keyof ProviderConfig>(service: K): NonNullable<ProviderConfig[K]> {
    const value = this.config[service];
    if (!value) throw new Error(`configuration_required:${service}`);
    const required: Record<keyof ProviderConfig, string[]> = { slack: ["token", "channel", "teamId"], linear: ["apiKey", "teamId"], github: ["dispatchToken", "repository", "controllerBranch", "engineeringGrantSecret"], vercel: ["token", "projectId", "projectName", "productionDomain"] };
    for (const key of required[service]) if (!(value as Record<string, unknown>)[key]) throw new Error(`configuration_required:${service}.${key}`);
    return value as NonNullable<ProviderConfig[K]>;
  }
  private async request(service: keyof ProviderConfig, endpoint: string, method = "GET", payload?: unknown, capability: "default" | "release" = "default") {
    const origins = { slack: "https://slack.com", linear: "https://api.linear.app", github: "https://api.github.com", vercel: "https://api.vercel.com" };
    const url = new URL(endpoint, origins[service]);
    if (url.origin !== origins[service]) throw new Error("provider_origin_forbidden");
    const config = this.require(service);
    let token: string;
    if (service === "linear") token = this.require("linear").apiKey;
    else if (service === "github") {
      const github = this.require("github");
      token = capability === "release" ? github.releaseToken ?? "" : method === "GET" ? github.readToken ?? github.dispatchToken : github.dispatchToken;
    } else token = (config as { token: string }).token;
    if (!token) throw new Error(`configuration_required:${service}.${capability}_token`);
    if (service === "vercel" && this.require("vercel").teamId) url.searchParams.set("teamId", this.require("vercel").teamId!);
    const response = await this.transport(url, { method, headers: { authorization: service === "linear" ? token : `Bearer ${token}`, "content-type": "application/json", ...(service === "github" ? { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error(`${service}_http_${response.status}`);
    if (response.status === 204) return null;
    const body = await response.text();
    if (!body) return null;
    const value: unknown = JSON.parse(body);
    if (service === "slack" && !z.object({ ok: z.literal(true) }).safeParse(value).success) throw new Error("slack_operation_rejected");
    if (service === "linear" && z.object({ errors: z.array(z.unknown()).min(1) }).safeParse(value).success) throw new Error("linear_operation_rejected");
    return value;
  }

  async slackPostApproval(card: ApprovalCard) {
    const config = this.require("slack");
    if (!card.authorityId || !card.bindingHash || card.expiresAt <= Date.now()) throw new Error("current_authority_required");
    const appUrl = new URL(card.appUrl); if (appUrl.protocol !== "https:") throw new Error("https_control_url_required");
    const choices = card.kind === "build" ? [["Build", "build"], ["No build", "no_build"]] : card.kind === "candidate_go" ? [["Go", "go"], ["No-go", "no_go"]] : card.kind === "persona_policy" ? [["Activate", "activate"], ["Reject", "reject"]] : [["Approve reply", "approve_reply"], ["No-go", "no_go"]];
    const blocks = [
      { type: "header", text: { type: "plain_text", text: card.title.slice(0, 150) } },
      { type: "section", text: { type: "plain_text", text: card.summary.slice(0, 2800) } },
      { type: "context", elements: [{ type: "plain_text", text: `Authority ${card.authorityId} · binding ${card.bindingHash} · expires ${new Date(card.expiresAt).toISOString()}` }] },
      { type: "actions", block_id: `fde:${card.authorityId}`, elements: [...choices.map(([label, action], index) => ({ type: "button", action_id: `fde_${action}`, text: { type: "plain_text", text: label }, style: index === 0 ? "primary" : "danger", value: JSON.stringify({ authorityId: card.authorityId, caseId: card.caseId, bindingHash: card.bindingHash, action }) })), { type: "button", action_id: "fde_open_case", text: { type: "plain_text", text: "Review exact evidence" }, url: appUrl.href }] },
    ];
    const receipt = z.object({ channel: z.string(), ts: z.string() }).parse(await this.request("slack", "/api/chat.postMessage", "POST", { channel: config.channel, thread_ts: card.threadTs, text: `${card.title}\n${card.summary}\nReview: ${appUrl.href}\nExpires: ${new Date(card.expiresAt).toISOString()}`, blocks, unfurl_links: false, unfurl_media: false, mrkdwn: false, metadata: { event_type: "fde_approval", event_payload: { authorityId: card.authorityId, caseId: card.caseId } } }));
    return { ...receipt, teamId: config.teamId, authorityId: card.authorityId };
  }
  async slackPostStatus(input: { text: string; threadTs: string; caseId: string }) {
    const config = this.require("slack");
    return z.object({ channel: z.string(), ts: z.string() }).parse(await this.request("slack", "/api/chat.postMessage", "POST", { channel: config.channel, thread_ts: input.threadTs, text: input.text.slice(0, 4000), mrkdwn: false, unfurl_links: false, unfurl_media: false }));
  }
  async linearFindCase(caseId: string) {
    const config = this.require("linear"), marker = `[fde-case:${caseId}]`;
    const result = z.object({ data: z.object({ issues: z.object({ nodes: z.array(issueSchema) }) }) }).parse(await this.request("linear", "/graphql", "POST", { query: "query FdeIssue($teamId: ID!, $marker: String!) { issues(first: 2, filter: {team: {id: {eq: $teamId}}, description: {contains: $marker}}) { nodes { id identifier url } } }", variables: { teamId: config.teamId, marker } }));
    if (result.data.issues.nodes.length > 1) throw new Error("linear_duplicate_case_requires_reconciliation");
    return result.data.issues.nodes[0] ?? null;
  }
  async linearCreateIssue(input: { caseId: string; title: string; description: string }) {
    const config = this.require("linear");
    const found = await this.linearFindCase(input.caseId); if (found) return { ...found, reconciled: true };
    const result = z.object({ data: z.object({ issueCreate: z.object({ success: z.literal(true), issue: issueSchema }) }) }).parse(await this.request("linear", "/graphql", "POST", { query: "mutation FdeCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }", variables: { input: { teamId: config.teamId, title: input.title.slice(0, 250), description: `[fde-case:${input.caseId}]\n\n${input.description}` } } }));
    return { ...result.data.issueCreate.issue, reconciled: false };
  }
  async linearUpdateIssue(input: { issueId: string; stateId: string; description?: string }) {
    const result = z.object({ data: z.object({ issueUpdate: z.object({ success: z.literal(true), issue: issueSchema }) }) }).parse(await this.request("linear", "/graphql", "POST", { query: "mutation FdeUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier url } } }", variables: { id: input.issueId, input: { stateId: input.stateId, ...(input.description === undefined ? {} : { description: input.description }) } } }));
    return result.data.issueUpdate.issue;
  }

  async githubDispatchCoding(input: { build: BuildRequest }) {
    const config = this.require("github"), build = buildRequestSchema.parse(input.build);
    if (build.repository !== config.repository || build.authorizationExpiresAt <= Date.now() || config.engineeringGrantSecret.length < 32) throw new Error("current_bound_build_required");
    const encoded = Buffer.from(JSON.stringify(build)).toString("base64"), signature = createHmac("sha256", config.engineeringGrantSecret).update(encoded).digest("hex");
    await this.request("github", `/repos/${config.controllerRepository ?? config.repository}/actions/workflows/${encodeURIComponent(config.workflowId ?? "restricted-coding.yml")}/dispatches`, "POST", { ref: config.controllerBranch, inputs: { build_request_base64: encoded, build_request_signature: signature } });
    return { status: "dispatched" as const, correlation: build.jobId, workflowId: config.workflowId ?? "restricted-coding.yml", runReceipt: null };
  }
  async githubInspectCandidate(input: { repository: string; pullNumber: number; expectedBaseSha: string; expectedHeadSha: string; requiredChecks: string[] }) {
    const config = this.require("github"); if (input.repository !== config.repository || !input.requiredChecks.length) throw new Error("repository_or_check_scope_required");
    const prefix = `/repos/${config.repository}`;
    const pull = z.object({ head: z.object({ sha }), base: z.object({ sha }), state: z.string(), merged: z.boolean(), html_url: z.string().url() }).parse(await this.request("github", `${prefix}/pulls/${input.pullNumber}`));
    if (pull.head.sha !== input.expectedHeadSha || pull.base.sha !== input.expectedBaseSha || pull.state !== "open" || pull.merged) throw new Error("candidate_pr_drift");
    const commit = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) }).parse(await this.request("github", `${prefix}/commits/${input.expectedHeadSha}`));
    const checks = z.object({ total_count: z.number(), check_runs: z.array(z.object({ name: z.string(), head_sha: sha, status: z.string(), conclusion: z.string().nullable(), details_url: z.string().nullable() })) }).parse(await this.request("github", `${prefix}/commits/${input.expectedHeadSha}/check-runs?per_page=100&filter=latest`));
    if (checks.total_count > 100) throw new Error("check_pagination_requires_review");
    for (const name of input.requiredChecks) if (!checks.check_runs.some(check => check.name === name && check.head_sha === input.expectedHeadSha && check.status === "completed" && check.conclusion === "success")) throw new Error(`required_check_incomplete:${name}`);
    return { headSha: pull.head.sha, baseSha: pull.base.sha, treeDigest: commit.commit.tree.sha, checksPassed: true as const, checkReceipts: checks.check_runs.filter(check => input.requiredChecks.includes(check.name)), pullUrl: pull.html_url };
  }
  async githubMergeExpectedHead(candidate: ReleaseCandidate) {
    const config = this.require("github"); if (candidate.repository !== config.repository) throw new Error("repository_scope_mismatch");
    return z.object({ sha, merged: z.literal(true) }).parse(await this.request("github", `/repos/${config.repository}/pulls/${candidate.pullNumber}/merge`, "PUT", { sha: candidate.headSha, merge_method: "merge" }, "release"));
  }
  async githubCommittedWeatherFiles(headSha: string, expectedTreeDigest: string) {
    const config = this.require("github"); sha.parse(headSha); sha.parse(expectedTreeDigest);
    const commit = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) }).parse(await this.request("github", `/repos/${config.repository}/commits/${headSha}`));
    if (commit.sha !== headSha || commit.commit.tree.sha !== expectedTreeDigest) throw new Error("candidate_tree_mismatch");
    const tree = z.object({ truncated: z.boolean(), tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha, size: z.number().optional() })) }).parse(await this.request("github", `/repos/${config.repository}/git/trees/${expectedTreeDigest}?recursive=1`));
    if (tree.truncated) throw new Error("candidate_tree_truncated");
    const allowed = tree.tree.filter(file => isWeatherBuildFile(file.path));
    assertWeatherBuildFiles(allowed.map(file => file.path));
    if (allowed.some(file => file.type !== "blob" || file.mode !== "100644" || (file.size ?? 0) > 500_000)) throw new Error("candidate_file_scope_invalid");
    const files: { file: string; data: string; encoding: "base64" }[] = [];
    for (const entry of allowed) {
      const blob = z.object({ sha, encoding: z.literal("base64"), content: z.string(), size: z.number().max(500_000) }).parse(await this.request("github", `/repos/${config.repository}/git/blobs/${entry.sha}`));
      if (blob.sha !== entry.sha) throw new Error("candidate_blob_mismatch");
      files.push({ file: entry.path, data: blob.content.replace(/\n/g, ""), encoding: "base64" });
    }
    if (!files.some(file => file.file === "package.json") || !files.some(file => file.file === "protected/version.ts")) throw new Error("trusted_weather_target_missing");
    return files;
  }

  async vercelDeployment(deploymentId: string) {
    const config = this.require("vercel");
    const deployment = z.object({ id: z.string(), projectId: z.string(), url: z.string(), target: z.string().nullable(), readyState: z.string(), meta: z.record(z.string(), z.string()).default({}) }).parse(await this.request("vercel", `/v13/deployments/${encodeURIComponent(deploymentId)}`));
    if (deployment.projectId !== config.projectId) throw new Error("vercel_project_mismatch");
    return deployment;
  }
  async vercelFindCandidate(candidateId: string) {
    const config = this.require("vercel");
    const listing = z.object({ deployments: z.array(z.object({ uid: z.string(), meta: z.record(z.string(), z.string()).optional() })), pagination: z.object({ next: z.number().nullable() }).optional() }).parse(await this.request("vercel", `/v6/deployments?projectId=${encodeURIComponent(config.projectId)}&target=production&limit=100`));
    const matches = listing.deployments.filter(deployment => deployment.meta?.candidateId === candidateId);
    if (matches.length > 1) throw new Error("duplicate_staged_candidate_requires_reconciliation");
    if (matches.length) return this.vercelDeployment(matches[0].uid);
    if (listing.pagination?.next) throw new Error("deployment_history_requires_reconciliation");
    return null;
  }
  async vercelProductionIdentity() {
    const config = this.require("vercel");
    const alias = z.object({ projectId: z.string(), deploymentId: z.string().optional(), deployment: z.object({ id: z.string() }).optional() }).parse(await this.request("vercel", `/v4/aliases/${encodeURIComponent(config.productionDomain)}`));
    if (alias.projectId !== config.projectId || !(alias.deploymentId ?? alias.deployment?.id)) throw new Error("production_identity_unverified");
    return { projectId: config.projectId, domain: config.productionDomain, deploymentId: alias.deploymentId ?? alias.deployment!.id };
  }
  async vercelVerifyStagingConfiguration() {
    const config = this.require("vercel");
    const project = z.object({ id: z.string(), autoAssignCustomDomains: z.boolean().optional(), rootDirectory: z.string().nullable().optional(), link: z.object({ productionBranch: z.string().optional() }).optional() }).parse(await this.request("vercel", `/v9/projects/${encodeURIComponent(config.projectId)}`));
    if (project.id !== config.projectId || project.autoAssignCustomDomains !== false) throw new Error("production_auto_assignment_must_be_disabled_and_verifiable");
    if (project.rootDirectory && project.rootDirectory !== ".") throw new Error("separate_weather_project_root_required");
    const envs = z.object({ envs: z.array(z.object({ key: z.string() })) }).parse(await this.request("vercel", `/v9/projects/${encodeURIComponent(config.projectId)}/env`));
    const allowedKeys = new Set(["WEATHER_RUN_ID", "WEATHER_CANDIDATE_ID", "WEATHER_HEAD_SHA", "WEATHER_TREE_DIGEST", "WEATHER_TRUSTED_TEST_REVISION", "WEATHER_BUILD_CONFIG_REVISION", "WEATHER_DEPLOYMENT_MODE"]);
    if (envs.envs.some(entry => !allowedKeys.has(entry.key))) throw new Error("weather_project_must_contain_only_public_identity_configuration");
    return { automaticDomainAssignmentDisabled: true as const, weatherProjectContainsNoSecrets: true as const, verifiedAt: Date.now() };
  }
  async vercelCreateStaged(input: { files: { file: string; data: string; encoding: "utf-8" | "base64" }[]; metadata: { runId: string; candidateId: string; headSha: string; treeDigest: string; trustedTestRevision: string; buildConfigRevision: string } }) {
    const config = this.require("vercel"); await this.vercelVerifyStagingConfiguration();
    const previous = await this.vercelProductionIdentity();
    if (!input.files.length || input.files.some(file => file.file.startsWith("/") || file.file.includes("\\") || file.file.split("/").some(segment => !segment || segment === ".." || segment === "." || segment.startsWith(".env") || segment === ".git"))) throw new Error("invalid_staging_file");
    const env = { WEATHER_RUN_ID: input.metadata.runId, WEATHER_CANDIDATE_ID: input.metadata.candidateId, WEATHER_HEAD_SHA: input.metadata.headSha, WEATHER_TREE_DIGEST: input.metadata.treeDigest, WEATHER_TRUSTED_TEST_REVISION: input.metadata.trustedTestRevision, WEATHER_BUILD_CONFIG_REVISION: input.metadata.buildConfigRevision, WEATHER_DEPLOYMENT_MODE: "live" };
    if (Object.values(env).some(value => !value)) throw new Error("staging_provenance_required");
    const deployment = z.object({ id: z.string(), url: z.string(), readyState: z.string() }).parse(await this.request("vercel", "/v13/deployments", "POST", { name: config.projectName, project: config.projectId, target: "production", alias: [], files: input.files, meta: input.metadata, env, projectSettings: { framework: "nextjs", rootDirectory: ".", installCommand: "bunx bun@1.4.2 install --frozen-lockfile --ignore-scripts", buildCommand: "bunx bun@1.4.2 run build" } }));
    return { ...deployment, previousDeploymentId: previous.deploymentId, status: "staging" as const };
  }
  async vercelPromoteExact(input: { deploymentId: string; candidateId: string; headSha: string; treeDigest: string; trustedTestRevision: string; buildConfigRevision: string }) {
    const config = this.require("vercel"), deployment = await this.vercelDeployment(input.deploymentId);
    if (deployment.target !== "production" || deployment.readyState !== "READY" || Object.entries(input).some(([key, value]) => key !== "deploymentId" && deployment.meta[key] !== value)) throw new Error("exact_staged_production_candidate_required");
    const before = await this.vercelProductionIdentity();
    if (before.deploymentId === input.deploymentId) return { status: "already_current" as const, deploymentId: input.deploymentId };
    await this.request("vercel", `/v10/projects/${encodeURIComponent(config.projectId)}/promote/${encodeURIComponent(input.deploymentId)}`, "POST");
    return { status: "promotion_requested" as const, deploymentId: input.deploymentId, previousDeploymentId: before.deploymentId };
  }
}
