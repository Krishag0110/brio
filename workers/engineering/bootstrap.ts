import { z } from "zod";

// This reviewed exception validates only the existing toolchain migration.
// Updating either revision requires another controller code review.
export const BOOTSTRAP = {
  repository: "Aarush-Dubey/hackathon-weather",
  pullNumber: 1,
  baseSha: "e8ab2824ec926a6ba60a088bbd84c935f8670cf8",
  headSha: "a96c50ee70b0a97171b03cde8ea10df6a2f008c8",
  changes: ["A\t.bun-version", "M\tREADME.md", "A\tbun.lock", "D\tpackage-lock.json", "M\tpackage.json"],
} as const;

export function assertBootstrapSource(input: {
  repository: string; baseSha: string; headSha: string; changes: string[];
  originalTemperature: string; temperature: string; packageManager: string;
  bunVersion: string; previousDependencies: unknown; dependencies: unknown;
}) {
  if (input.repository !== BOOTSTRAP.repository || input.baseSha !== BOOTSTRAP.baseSha || input.headSha !== BOOTSTRAP.headSha) throw new Error("unreviewed_bootstrap_revision");
  if (JSON.stringify([...input.changes].sort()) !== JSON.stringify([...BOOTSTRAP.changes].sort())) throw new Error("bootstrap_scope_changed");
  if (input.originalTemperature !== input.temperature) throw new Error("seeded_defect_source_changed");
  if (input.packageManager !== "bun@1.4.2" || input.bunVersion.trim() !== "1.4.2") throw new Error("bootstrap_bun_version_changed");
  const sorted = (value: unknown) => JSON.stringify(Object.entries(z.record(z.string(), z.string()).parse(value)).sort(([a], [b]) => a.localeCompare(b)));
  if (sorted(input.previousDependencies) !== sorted(input.dependencies)) throw new Error("bootstrap_production_dependencies_changed");
}

export const bootstrapReceiptSchema = z.object({
  kind: z.literal("reviewed_bun_bootstrap"), repository: z.literal(BOOTSTRAP.repository),
  pullNumber: z.literal(BOOTSTRAP.pullNumber), baseSha: z.literal(BOOTSTRAP.baseSha), headSha: z.literal(BOOTSTRAP.headSha),
  treeDigest: z.string().regex(/^[a-f0-9]{40}$/), controllerSha: z.string().regex(/^[a-f0-9]{40}$/),
  workflowRunId: z.string().regex(/^\d+$/), completedAt: z.string().datetime(),
  checks: z.object({ sourceScope: z.literal(true), bunFrozenInstall: z.literal(true), build: z.literal(true), typecheck: z.literal(true), protectedBaseline: z.literal(true) }).strict(),
  weatherQa: z.object({ status: z.literal("failed"), seededDefectReproduced: z.literal(true), identityPassed: z.literal(true), checkCount: z.literal(34) }).strict(),
}).strict();
export type BootstrapReceipt = z.infer<typeof bootstrapReceiptSchema>;

export async function publishBootstrapCheck(input: {
  receipt: unknown; controllerSha: string; workflowRunId: string; controllerRepository: string;
  readToken: string; checksToken: string; transport?: typeof fetch;
}) {
  if (!input.readToken || !input.checksToken) throw new Error("configuration_required:bootstrap_github_capabilities");
  const receipt = bootstrapReceiptSchema.parse(input.receipt);
  if (receipt.controllerSha !== input.controllerSha || receipt.workflowRunId !== input.workflowRunId || input.controllerRepository !== "Aarush-Dubey/hackathon") throw new Error("bootstrap_workflow_binding_mismatch");
  const request = async (path: string, token: string, body?: unknown) => {
    const response = await (input.transport ?? fetch)(`https://api.github.com${path}`, {
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`bootstrap_github_http_${response.status}`);
    return response.json();
  };
  const pr = z.object({ state: z.literal("open"), merged: z.literal(false), head: z.object({ sha: z.literal(BOOTSTRAP.headSha), repo: z.object({ full_name: z.literal(BOOTSTRAP.repository) }) }), base: z.object({ ref: z.literal("main"), sha: z.literal(BOOTSTRAP.baseSha), repo: z.object({ full_name: z.literal(BOOTSTRAP.repository) }) }) }).parse(await request(`/repos/${BOOTSTRAP.repository}/pulls/${BOOTSTRAP.pullNumber}`, input.readToken));
  const commit = z.object({ sha: z.literal(pr.head.sha), tree: z.object({ sha: z.literal(receipt.treeDigest) }) }).parse(await request(`/repos/${BOOTSTRAP.repository}/git/commits/${pr.head.sha}`, input.readToken));
  const runUrl = `https://github.com/${input.controllerRepository}/actions/runs/${input.workflowRunId}`;
  return z.object({ id: z.number(), head_sha: z.literal(commit.sha), conclusion: z.literal("success") }).parse(await request(`/repos/${BOOTSTRAP.repository}/check-runs`, input.checksToken, {
    name: "Protected weather", head_sha: receipt.headSha, status: "completed", conclusion: "success", completed_at: receipt.completedAt,
    details_url: runUrl, external_id: `bun-bootstrap:${input.workflowRunId}`,
    output: { title: "Reviewed Bun migration passed; seeded weather defect retained", summary: `Bootstrap validation only, not a generated fix or release approval. Exact reviewed PR #1 source scope, Bun 1.4.2 frozen install, production build, typecheck, and protected baseline reproduction passed. The 34-check weather QA evidence intentionally remains FAILED: 20°C still displays 20°F, and the seeded defect was reproduced with matching identity. Base ${receipt.baseSha}; head ${receipt.headSha}; tree ${receipt.treeDigest}; trusted controller ${receipt.controllerSha}. See this workflow run's evidence artifact.` },
  }));
}
