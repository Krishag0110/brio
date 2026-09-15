import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { buildRequestSchema } from "./coding-runner";
import { writeCandidatePr } from "./github-pr";
import { EngineeringController } from "./http-controller";
import { requireSecret, safeEqual } from "../shared/security";

async function main() {
  const callbackSecret = requireSecret(process.env.ENGINEERING_CALLBACK_SECRET, "ENGINEERING_CALLBACK_SECRET"), directory = process.env.CANDIDATE_OUTPUT_DIRECTORY ?? "candidate-output";
  const artifact = await readFile(`${directory}/verified-patch.json`), signature = (await readFile(`${directory}/verified-patch.sig`, "utf8")).trim();
  if (!safeEqual(createHmac("sha256", callbackSecret).update(artifact).digest("hex"), signature)) throw new Error("candidate_artifact_signature_invalid");
  const result = z.object({ status: z.literal("verified_patch"), request: buildRequestSchema, finalFiles: z.array(z.object({ path: z.string(), content: z.string(), beforeSha256: z.string() })), attempts: z.number().int().min(1).max(3) }).parse(JSON.parse(artifact.toString()));
  const controller = new EngineeringController(process.env.CONVEX_SITE_URL ?? "configuration_required", callbackSecret);
  await controller.authorize(result.request, "write_pr");
  const receipt = await writeCandidatePr({ token: process.env.GITHUB_PR_TOKEN ?? "", build: result.request, files: result.finalFiles, defaultBranch: process.env.GITHUB_DEFAULT_BRANCH ?? "main" });
  const checkToken = process.env.GITHUB_CHECKS_TOKEN;
  if (!checkToken) throw new Error("configuration_required:GITHUB_CHECKS_TOKEN");
  // The trusted Git tree writer used only the exact verified source and approved base tree.
  // Explicitly attach that evidence to the resulting head instead of relying on bot-push triggers.
  const response = await fetch(`https://api.github.com/repos/${result.request.repository}/check-runs`, { method: "POST", headers: { authorization: `Bearer ${checkToken}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" }, body: JSON.stringify({ name: "Protected weather", head_sha: receipt.headSha, status: "completed", conclusion: "success", completed_at: new Date().toISOString(), external_id: result.request.jobId, output: { title: "Restricted source and protected browser checks passed", summary: `The trusted runner checked the exact allowlisted source used in this Git tree. Controller revision: ${result.request.trustedControllerSha}. Tree: ${receipt.treeDigest}. Attempts: ${result.attempts}. The staged production deployment still requires separate protected browser verification before Go.` } }), signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!response.ok) throw new Error(`github_check_creation_failed:${response.status}`);
  const check = z.object({ id: z.number(), head_sha: z.literal(receipt.headSha), conclusion: z.literal("success") }).parse(await response.json());
  await controller.send("engineering-result", { jobId: result.request.jobId, attemptId: result.request.attemptId, result: { status: "pr_created", ...receipt, checkId: check.id, trustedControllerSha: result.request.trustedControllerSha } });
}
main().catch(() => { process.stderr.write("trusted_pr_job_failed_or_blocked\n"); process.exitCode = 1; });
