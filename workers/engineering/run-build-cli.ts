import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { buildRequestSchema, DockerRestrictedVerifier, runRestrictedCoding } from "./coding-runner";
import { EngineeringController } from "./http-controller";
import { requireSecret, safeEqual } from "../shared/security";

async function main() {
  const encoded = process.env.BUILD_REQUEST_BASE64 ?? "", signature = process.env.BUILD_REQUEST_SIGNATURE ?? "";
  const grantSecret = requireSecret(process.env.ENGINEERING_GRANT_SECRET, "ENGINEERING_GRANT_SECRET");
  if (!safeEqual(createHmac("sha256", grantSecret).update(encoded).digest("hex"), signature)) throw new Error("invalid_engineering_grant");
  const request = buildRequestSchema.parse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  const controller = new EngineeringController(process.env.CONVEX_SITE_URL ?? "configuration_required", requireSecret(process.env.ENGINEERING_CALLBACK_SECRET, "ENGINEERING_CALLBACK_SECRET"));
  const controllerDirectory = process.env.TRUSTED_CONTROLLER_DIRECTORY ?? process.cwd(), repositoryDirectory = process.env.TARGET_REPOSITORY_DIRECTORY;
  if (!repositoryDirectory) throw new Error("configuration_required:TARGET_REPOSITORY_DIRECTORY");
  if (await realpath(controllerDirectory) === await realpath(repositoryDirectory)) throw new Error("separate_weather_repository_required");
  const exec = promisify(execFile);
  const actualController = (await exec("git", ["rev-parse", "HEAD"], { cwd: controllerDirectory, env: { PATH: process.env.PATH, NODE_ENV: "production" } })).stdout.trim();
  const actualBase = (await exec("git", ["rev-parse", "HEAD"], { cwd: repositoryDirectory, env: { PATH: process.env.PATH, NODE_ENV: "production" } })).stdout.trim();
  if (actualController !== request.trustedControllerSha || actualBase !== request.baseSha) throw new Error("checkout_revision_mismatch");
  await controller.authorize(request, "verify");
  const outputDirectory = process.env.CANDIDATE_OUTPUT_DIRECTORY ?? `${process.cwd()}/candidate-output`;
  const result = await runRestrictedCoding({ request, repositoryDirectory, trustedControllerDirectory: controllerDirectory, broker: controller, authority: controller, verifier: new DockerRestrictedVerifier(process.env.CODING_SANDBOX_IMAGE ?? "configuration_required", `${outputDirectory}/evidence`), outputDirectory });
  await controller.send("engineering-result", { jobId: request.jobId, attemptId: request.attemptId, result });
  if (result.status !== "verified_patch") process.exitCode = 1;
  // Touch only trusted-generated JSON; the separate PR job consumes this file with different authority.
  if (result.status === "verified_patch") {
    const artifact = await readFile(`${outputDirectory}/verified-patch.json`);
    await writeFile(`${outputDirectory}/verified-patch.sig`, createHmac("sha256", requireSecret(process.env.ENGINEERING_CALLBACK_SECRET, "ENGINEERING_CALLBACK_SECRET")).update(artifact).digest("hex"));
  }
}
main().catch(() => { process.stderr.write("engineering_job_failed_or_blocked\n"); process.exitCode = 1; });
