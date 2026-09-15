import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { assertBootstrapSource, BOOTSTRAP, bootstrapReceiptSchema, publishBootstrapCheck } from "./bootstrap";

async function main() {
  const mode = process.argv[2], output = path.resolve("bootstrap-output");
  const controllerSha = process.env.GITHUB_SHA ?? "", workflowRunId = process.env.GITHUB_RUN_ID ?? "";
  if (process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_REPOSITORY !== "Aarush-Dubey/hackathon" || !/^[a-f0-9]{40}$/.test(controllerSha) || !/^\d+$/.test(workflowRunId)) throw new Error("reviewed_main_workflow_required");
  if (mode === "source") {
    const target = process.env.WEATHER_TARGET_PATH;
    if (!target || await realpath(target) === await realpath(process.cwd())) throw new Error("separate_bootstrap_target_required");
    const exec = promisify(execFile);
    const git = async (...args: string[]) => (await exec("git", args, { cwd: target, env: { PATH: process.env.PATH, NODE_ENV: "production" }, maxBuffer: 200_000 })).stdout;
    const headSha = (await git("rev-parse", "HEAD")).trim(), baseSha = (await git("rev-parse", BOOTSTRAP.baseSha)).trim();
    await git("merge-base", "--is-ancestor", baseSha, headSha);
    const pkg = JSON.parse(await git("show", `${headSha}:package.json`)), previous = JSON.parse(await git("show", `${baseSha}:package.json`));
    assertBootstrapSource({ repository: BOOTSTRAP.repository, baseSha, headSha, changes: (await git("diff", "--name-status", "--no-renames", baseSha, headSha)).trim().split("\n"),
      originalTemperature: await git("show", `${baseSha}:lib/temperature.ts`), temperature: await git("show", `${headSha}:lib/temperature.ts`), packageManager: pkg.packageManager,
      bunVersion: await git("show", `${headSha}:.bun-version`), dependencies: pkg.dependencies, previousDependencies: previous.dependencies });
    if ((await git("status", "--porcelain", "--untracked-files=no")).trim()) throw new Error("bootstrap_checkout_modified");
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "source.json"), JSON.stringify({ repository: BOOTSTRAP.repository, baseSha, headSha, treeDigest: (await git("rev-parse", "HEAD^{tree}")).trim(), controllerSha, workflowRunId }));
  } else if (mode === "receipt") {
    const source = JSON.parse(await readFile(path.join(output, "source.json"), "utf8"));
    const evidence = z.object({ status: z.literal("failed"), seededDefectReproduced: z.literal(true), identityPassed: z.literal(true), checks: z.array(z.unknown()).length(34) }).parse(JSON.parse(await readFile("tests/execution/artifacts/protected-baseline-browser-evidence.json", "utf8")));
    const receipt = bootstrapReceiptSchema.parse({ ...source, kind: "reviewed_bun_bootstrap", pullNumber: BOOTSTRAP.pullNumber, completedAt: new Date().toISOString(), checks: { sourceScope: true, bunFrozenInstall: true, build: true, typecheck: true, protectedBaseline: true }, weatherQa: { status: evidence.status, seededDefectReproduced: evidence.seededDefectReproduced, identityPassed: evidence.identityPassed, checkCount: evidence.checks.length } });
    if (receipt.controllerSha !== controllerSha || receipt.workflowRunId !== workflowRunId) throw new Error("bootstrap_receipt_binding_mismatch");
    await writeFile(path.join(output, "validation.json"), JSON.stringify(receipt, null, 2));
  } else if (mode === "publish") {
    await publishBootstrapCheck({ receipt: JSON.parse(await readFile(path.join(output, "validation.json"), "utf8")), controllerSha, workflowRunId,
      controllerRepository: process.env.GITHUB_REPOSITORY, readToken: process.env.GITHUB_PR_TOKEN ?? "", checksToken: process.env.GITHUB_CHECKS_TOKEN ?? "" });
  } else throw new Error("bootstrap_mode_invalid");
  process.stdout.write(`Reviewed Bun bootstrap ${mode} completed. The seeded conversion defect remains.\n`);
}
main().catch(() => { process.stderr.write("reviewed_bun_bootstrap_failed_or_blocked\n"); process.exitCode = 1; });
