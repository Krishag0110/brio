import { z } from "zod";
import { assertAllowedPath } from "./patch-guard";
import type { BuildRequest } from "./coding-runner";
import { sha256 } from "../shared/security";

/** GitHub writes run only in trusted orchestration, with a PR/contents token scoped to one repository. */
export async function writeCandidatePr(options: { token: string; build: BuildRequest; files: { path: string; content: string; beforeSha256: string }[]; defaultBranch: string }) {
  const { build } = options;
  if (!options.token || !options.files.length) throw new Error("github_pr_configuration_required");
  for (const file of options.files) { assertAllowedPath(file.path, build.allowedPaths); if (sha256(file.content) !== file.beforeSha256) throw new Error("candidate_content_digest_mismatch"); }
  const branch = `codex/fde-${build.caseId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)}`;
  const marker = `<!-- fde-case:${build.caseId} -->`;
  async function request(endpoint: string, method = "GET", data?: unknown): Promise<{ status: number; value: unknown }> {
    const response = await fetch(`https://api.github.com/repos/${build.repository}${endpoint}`, { method, headers: { authorization: `Bearer ${options.token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok && response.status !== 404) throw new Error(`github_pr_request_failed:${response.status}`);
    return { status: response.status, value: await response.json() };
  }
  const base = z.object({ sha: z.string(), commit: z.object({ tree: z.object({ sha: z.string() }) }) }).parse((await request(`/commits/${build.baseSha}`)).value);
  const currentBase = z.object({ sha: z.string() }).parse((await request(`/commits/${encodeURIComponent(options.defaultBranch)}`)).value);
  if (base.sha !== build.baseSha || currentBase.sha !== build.baseSha) throw new Error("repository_base_drift");
  const branchState = await request(`/git/ref/heads/${encodeURIComponent(branch)}`);
  const branchHead = branchState.status === 404 ? build.baseSha : z.object({ object: z.object({ sha: z.string() }) }).parse(branchState.value).object.sha;
  // An existing branch belongs to this incident; resume only when its diff is still entirely allowlisted.
  if (branchHead !== build.baseSha) {
    const comparison = z.object({ files: z.array(z.object({ filename: z.string(), status: z.string() })) }).parse((await request(`/compare/${build.baseSha}...${branchHead}`)).value);
    for (const file of comparison.files) { assertAllowedPath(file.filename, build.allowedPaths); if (file.status !== "modified") throw new Error("incident_branch_drift"); }
  }
  const tree = z.object({ sha: z.string() }).parse((await request("/git/trees", "POST", { base_tree: base.commit.tree.sha, tree: options.files.map(file => ({ path: file.path, mode: "100644", type: "blob", content: file.content })) })).value);
  const commit = z.object({ sha: z.string() }).parse((await request("/git/commits", "POST", { message: `Fix weather conversion for ${build.caseId}\n\n${build.linearUrl}`, tree: tree.sha, parents: [branchHead] })).value);
  if (branchState.status === 404) await request("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: commit.sha });
  else await request(`/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", { sha: commit.sha, force: false });
  const existing = z.array(z.object({ number: z.number(), html_url: z.string(), body: z.string().nullable() })).parse((await request(`/pulls?state=open&head=${encodeURIComponent(build.repository.split("/")[0] + ":" + branch)}`)).value);
  let pull = existing.find(item => item.body?.includes(marker));
  if (existing.length && !pull) throw new Error("incident_pr_identity_mismatch");
  if (!pull) pull = z.object({ number: z.number(), html_url: z.string(), body: z.string().nullable() }).parse((await request("/pulls", "POST", { title: "Fix weather temperature unit conversion", head: branch, base: options.defaultBranch, body: `${marker}\n\nThe owned weather fixture displays its Celsius value after switching to Fahrenheit. This candidate updates only the engineer-approved conversion source.\n\nLinear: ${build.linearUrl}\n\nProtected container checks passed before this PR. Explicit verification of this exact commit and staged production deployment is still required before marketer Go.`, draft: false })).value);
  return { branch, headSha: commit.sha, treeDigest: tree.sha, pullNumber: pull.number, pullUrl: pull.html_url };
}
