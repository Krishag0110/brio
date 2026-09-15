import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { applyVerifiedPatch, inspectAllowedFiles, patchSchema, type PatchProposal } from "./patch-guard";
import { copyWeatherBuildInputs } from "./copy-weather";
const exec = promisify(execFile);

export const buildRequestSchema = z.object({
  jobId: z.string(), attemptId: z.string(), workspaceId: z.string(), caseId: z.string(),
  authorizationRef: z.string(), authorizationExpiresAt: z.number(), scopeHash: z.string(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  trustedControllerSha: z.string().regex(/^[a-f0-9]{40}$/),
  allowedPaths: z.array(z.string()).min(1), approvedPlan: z.string().max(6000),
  acceptanceCriteria: z.array(z.string().max(1000)).min(1).max(20),
  linearUrl: z.string().url(), buildConfigRevision: z.string(),
}).strict();
export type BuildRequest = z.infer<typeof buildRequestSchema>;
export interface ModelBroker {
  propose(request: { build: BuildRequest; model: "gpt-5-mini"; attempt: number; files: Awaited<ReturnType<typeof inspectAllowedFiles>>; previousFailures: string[] }): Promise<{ proposal: unknown; reservationId: string; model: "gpt-5-mini" }>;
}
export interface CodingAuthority { authorize(build: BuildRequest, effect: "model" | "verify" | "write_pr"): Promise<void> }
export interface RestrictedVerifier { ready?(): Promise<void>; verify(candidateDirectory: string, trustedControllerDirectory: string): Promise<{ passed: boolean; evidencePath: string; failures: string[] }> }

/** Docker performs all candidate builds/tests. No shell, environment passthrough, socket, or host home mounts. */
export class DockerRestrictedVerifier implements RestrictedVerifier {
  constructor(private readonly image: string, private readonly evidenceDirectory: string) {
    if (!/^[-\w./:]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("sandbox_image_digest_required");
  }
  async ready() {
    await exec("docker", ["image", "inspect", "--format", "{{.Id}}", this.image], { timeout: 10_000, maxBuffer: 1024, env: { PATH: process.env.PATH, NODE_ENV: "production" } }).catch(() => { throw new Error("restricted_runtime_unavailable"); });
  }
  async verify(candidateDirectory: string, trustedControllerDirectory: string) {
    await mkdir(this.evidenceDirectory, { recursive: true });
    await chmod(this.evidenceDirectory, 0o700);
    const result = await exec("docker", ["run", "--rm", "--init", "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=SETUID", "--cap-add=SETGID", "--cap-add=CHOWN", "--cap-add=DAC_OVERRIDE", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2", "--user=0:0", "--tmpfs=/tmp:rw,nosuid,nodev,size=256m", "--mount", `type=bind,src=${path.resolve(candidateDirectory)},dst=/candidate`, "--mount", `type=bind,src=${path.resolve(trustedControllerDirectory, "workers/engineering")},dst=/trusted,readonly`, "--mount", `type=bind,src=${path.resolve(trustedControllerDirectory, "workers/shared")},dst=/shared,readonly`, "--mount", `type=bind,src=${path.resolve(this.evidenceDirectory)},dst=/evidence`, `--env=SANDBOX_RETURN_UID=${process.getuid?.() ?? 1000}`, `--env=SANDBOX_RETURN_GID=${process.getgid?.() ?? 1000}`, "--env=HOME=/tmp", "--env=NEXT_TELEMETRY_DISABLED=1", "--env=WEATHER_ALLOW_LOCALHOST=true", this.image, "timeout", "280", "node", "--import", "tsx", "/trusted/sandbox-entry.ts"], { timeout: 300_000, maxBuffer: 4096, env: { PATH: process.env.PATH, NODE_ENV: "production" }, killSignal: "SIGKILL" }).then(() => true).catch(() => false);
    const evidencePath = path.join(this.evidenceDirectory, "verification.json");
    const evidence = z.object({ passed: z.boolean(), failures: z.array(z.string()) }).safeParse(JSON.parse(await readFile(evidencePath, "utf8").catch(() => "null")));
    return { passed: result && evidence.success && evidence.data.passed, evidencePath, failures: evidence.success ? evidence.data.failures : ["restricted_verification_failed_or_runtime_unavailable"] };
  }
}

export async function runRestrictedCoding(options: { request: BuildRequest; repositoryDirectory: string; trustedControllerDirectory: string; broker: ModelBroker; authority: CodingAuthority; verifier: RestrictedVerifier; outputDirectory: string }) {
  const request = buildRequestSchema.parse(options.request);
  if (request.authorizationExpiresAt <= Date.now()) throw new Error("build_expired");
  await options.verifier.ready?.();
  const scratch = await mkdtemp(path.join(os.tmpdir(), "fde-candidate-"));
  const proposals: PatchProposal[] = [], reservations: string[] = [];
  try {
    // Do not copy a host repository, .git, .env, or credentials into candidate execution.
    await copyWeatherBuildInputs(options.repositoryDirectory, scratch);
    let previousFailures: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (request.authorizationExpiresAt <= Date.now()) throw new Error("build_expired");
      await options.authority.authorize(request, "model");
      const files = await inspectAllowedFiles(scratch, request.allowedPaths);
      const response = await options.broker.propose({ build: request, model: "gpt-5-mini", attempt, files, previousFailures });
      if (response.model !== "gpt-5-mini" || !response.reservationId) throw new Error("unbudgeted_or_wrong_model");
      reservations.push(response.reservationId);
      const proposal = await applyVerifiedPatch(scratch, patchSchema.parse(response.proposal), request.allowedPaths);
      proposals.push(proposal);
      const approvedSource = await inspectAllowedFiles(scratch, request.allowedPaths);
      await options.authority.authorize(request, "verify");
      const verified = await options.verifier.verify(scratch, options.trustedControllerDirectory);
      if (verified.passed) {
        await options.authority.authorize(request, "write_pr");
        await mkdir(options.outputDirectory, { recursive: true });
        // The PR writer gets only allowlisted source, never a candidate-produced command/artifact.
        const finalFiles = await inspectAllowedFiles(scratch, request.allowedPaths);
        if (JSON.stringify(finalFiles) !== JSON.stringify(approvedSource)) throw new Error("source_changed_during_verification");
        const candidate = { status: "verified_patch" as const, request, proposals, finalFiles, reservations, attempts: attempt + 1, evidencePath: verified.evidencePath };
        await writeFile(path.join(options.outputDirectory, "verified-patch.json"), JSON.stringify(candidate, null, 2));
        return candidate;
      }
      previousFailures = verified.failures.map(failure => failure.slice(0, 500)).slice(0, 20);
    }
    return { status: "checks_failed" as const, attempts: 3, reservations, failures: previousFailures };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
