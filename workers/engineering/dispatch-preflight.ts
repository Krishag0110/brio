import { createHmac } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { buildRequestSchema } from "./coding-runner";
import { requireSecret, safeEqual } from "../shared/security";

async function main() {
  const encoded = process.env.BUILD_REQUEST_BASE64 ?? "", signature = process.env.BUILD_REQUEST_SIGNATURE ?? "";
  if (!safeEqual(createHmac("sha256", requireSecret(process.env.ENGINEERING_GRANT_SECRET, "ENGINEERING_GRANT_SECRET")).update(encoded).digest("hex"), signature)) throw new Error("invalid_build_signature");
  const build = buildRequestSchema.parse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  if (build.authorizationExpiresAt <= Date.now() || build.trustedControllerSha !== process.env.GITHUB_SHA || build.repository !== process.env.WEATHER_TARGET_REPOSITORY) throw new Error("build_dispatch_binding_mismatch");
  if (!process.env.GITHUB_OUTPUT) throw new Error("trusted_workflow_required");
  await appendFile(process.env.GITHUB_OUTPUT, `base_sha=${build.baseSha}\nrepository=${build.repository}\n`);
}
main().catch(() => { process.stderr.write("build_dispatch_preflight_rejected\n"); process.exitCode = 1; });
