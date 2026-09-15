import { z } from "zod";
import { assertDeploymentBinding, type ReleaseCandidate, type ReleaseProvider } from "./release";

const commitSchema = z.object({ sha: z.string(), commit: z.object({ tree: z.object({ sha: z.string() }) }) });
const deploymentSchema = z.object({ id: z.string(), projectId: z.string(), target: z.string(), readyState: z.string(), meta: z.record(z.string(), z.string()).default({}) });

export class GitHubVercelProvider implements ReleaseProvider {
  constructor(private readonly options: { githubReleaseToken: string; vercelReleaseToken: string; vercelTeamId?: string; defaultBranch: string; requiredChecks?: string[]; verify: ReleaseProvider["verifyLive"] }) {
    if (!options.githubReleaseToken || !options.vercelReleaseToken) throw new Error("release_credentials_required");
  }
  private async request(service: "github" | "vercel", endpoint: string, method = "GET", value?: unknown): Promise<unknown> {
    const url = new URL(endpoint, service === "github" ? "https://api.github.com" : "https://api.vercel.com");
    if (service === "vercel" && this.options.vercelTeamId) url.searchParams.set("teamId", this.options.vercelTeamId);
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${service === "github" ? this.options.githubReleaseToken : this.options.vercelReleaseToken}`, "content-type": "application/json", ...(service === "github" ? { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } : {}) }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error(`${service}_request_failed:${response.status}`);
    const text = await response.text(); return text ? JSON.parse(text) : {};
  }
  async currentMain(repository: string) {
    const result = commitSchema.parse(await this.request("github", `/repos/${repository}/commits/${encodeURIComponent(this.options.defaultBranch)}`));
    return { sha: result.sha, tree: result.commit.tree.sha };
  }
  async pullHead(repository: string, pull: number) {
    const result = z.object({ head: z.object({ sha: z.string() }), merged: z.boolean(), merge_commit_sha: z.string().nullable() }).parse(await this.request("github", `/repos/${repository}/pulls/${pull}`));
    return { headSha: result.head.sha, merged: result.merged, mergeSha: result.merge_commit_sha ?? undefined };
  }
  async mergeExpectedHead(candidate: ReleaseCandidate) {
    const result = z.object({ sha: z.string(), merged: z.boolean() }).parse(await this.request("github", `/repos/${candidate.repository}/pulls/${candidate.pullNumber}/merge`, "PUT", { sha: candidate.headSha, merge_method: "merge", commit_title: `Resolve weather case ${candidate.candidateId}` }));
    if (!result.merged) throw new Error("merge_not_confirmed");
    return { mergeSha: result.sha };
  }
  async verifyChecks(candidate: ReleaseCandidate) {
    const required = this.options.requiredChecks ?? ["Protected weather"];
    if (!required.length || required.some(name => !name.trim())) throw new Error("protected_check_configuration_required");
    const checks = z.object({ total_count: z.number(), check_runs: z.array(z.object({ name: z.string(), head_sha: z.string(), status: z.string(), conclusion: z.string().nullable() })) }).parse(await this.request("github", `/repos/${candidate.repository}/commits/${candidate.headSha}/check-runs?per_page=100&filter=latest`));
    if (checks.total_count > 100) throw new Error("protected_check_pagination_requires_review");
    for (const name of required) if (!checks.check_runs.some(check => check.name === name && check.head_sha === candidate.headSha && check.status === "completed" && check.conclusion === "success")) throw new Error("protected_checks_changed");
  }
  async commitTree(repository: string, sha: string) { return commitSchema.parse(await this.request("github", `/repos/${repository}/commits/${sha}`)).commit.tree.sha; }
  async deployment(id: string) {
    const result = deploymentSchema.parse(await this.request("vercel", `/v13/deployments/${encodeURIComponent(id)}`));
    return { id: result.id, projectId: result.projectId, target: result.target, state: result.readyState, metadata: result.meta };
  }
  async currentProduction(projectId: string, domain: string) {
    const alias = z.object({ projectId: z.string(), deploymentId: z.string().optional(), deployment: z.object({ id: z.string() }).optional() }).parse(await this.request("vercel", `/v4/aliases/${encodeURIComponent(domain)}`));
    if (alias.projectId !== projectId || !(alias.deploymentId ?? alias.deployment?.id)) throw new Error("production_alias_unverified");
    return (alias.deploymentId ?? alias.deployment!.id)!;
  }
  async promote(projectId: string, deploymentId: string) {
    const deployment = await this.deployment(deploymentId);
    if (deployment.projectId !== projectId || deployment.target !== "production" || deployment.state !== "READY") throw new Error("staged_production_required");
    // The provider's promote endpoint points traffic to an existing deployment without rebuilding.
    await this.request("vercel", `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`, "POST");
  }
  verifyLive(candidate: ReleaseCandidate) { return this.options.verify(candidate); }

  async verifyStagedCandidate(candidate: ReleaseCandidate) { assertDeploymentBinding(candidate, await this.deployment(candidate.deploymentId)); }
}

export async function createStagedProduction(options: { token: string; projectId: string; projectName: string; teamId?: string; files: { file: string; data: string; encoding: "utf-8" | "base64" }[]; metadata: Record<string, string>; configurationVerified: { automaticDomainAssignmentDisabled: true; weatherProjectContainsNoSecrets: true; verifiedAt: number } }) {
  if (!options.token) throw new Error("vercel_upload_credentials_required");
  if (Date.now() - options.configurationVerified.verifiedAt > 300_000 || options.configurationVerified.verifiedAt > Date.now()) throw new Error("fresh_staging_configuration_check_required");
  // The trusted preflight must verify the saved project setting before this function is callable.
  // `alias: []` also declares no domains in this request. Never use an ordinary production push.
  const url = new URL("https://api.vercel.com/v13/deployments");
  if (options.teamId) url.searchParams.set("teamId", options.teamId);
  if (!options.files.length || options.files.some(file => file.file.includes("..") || file.file.startsWith("/") || file.file.includes("\\") || file.file.split("/").some(part => part.startsWith(".env") || part === ".git"))) throw new Error("invalid_deployment_files");
  const publicIdentity = Object.fromEntries([ ["WEATHER_RUN_ID", "runId"], ["WEATHER_CANDIDATE_ID", "candidateId"], ["WEATHER_HEAD_SHA", "headSha"], ["WEATHER_TREE_DIGEST", "treeDigest"], ["WEATHER_TRUSTED_TEST_REVISION", "trustedTestRevision"], ["WEATHER_BUILD_CONFIG_REVISION", "buildConfigRevision"] ].map(([key, field]) => {
    if (!options.metadata[field]) throw new Error("staging_provenance_required");
    return [key, options.metadata[field]];
  }));
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: options.projectName, project: options.projectId, target: "production", alias: [], files: options.files, meta: options.metadata, env: { ...publicIdentity, WEATHER_DEPLOYMENT_MODE: "live" }, projectSettings: { framework: "nextjs", rootDirectory: "." } }), signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error(`staging_request_failed:${response.status}`);
  return z.object({ id: z.string(), url: z.string(), readyState: z.string() }).parse(await response.json());
}
