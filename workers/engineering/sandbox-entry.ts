import { spawn } from "node:child_process";
import { chown, lchown, lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { provenanceSchema, verifyWeather } from "./protected-weather";

const failures: string[] = [];
function run(binary: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd: "/candidate", uid: 65532, gid: 65532, detached: true, env: { PATH: process.env.PATH, HOME: "/tmp", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timeout); if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } if (code === 0) resolve(); else reject(new Error(`check_exit_${code}`)); });
  });
}
async function main() {
  async function assignCandidateOwner(directory: string, uid: number, gid: number, rejectSymlinks = true): Promise<void> {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) { if (rejectSymlinks) throw new Error("candidate_symlink_forbidden"); await lchown(directory, uid, gid); return; }
    await chown(directory, uid, gid);
    if (stat.isDirectory()) for (const child of await readdir(directory)) await assignCandidateOwner(`${directory}/${child}`, uid, gid, rejectSymlinks);
  }
  // Read the expected controller-provided identity before any candidate build/runtime executes.
  const expectedProvenance = provenanceSchema.parse(JSON.parse(await readFile("/candidate/protected/provenance.json", "utf8")));
  await assignCandidateOwner("/candidate", 65532, 65532);
  try {
  try { await run("node", ["/runtime/node_modules/eslint/bin/eslint.js", "--config", "/trusted/candidate-eslint.config.mjs", "lib/temperature.ts"]); } catch { failures.push("lint_failed"); }
  try { await run("node", ["--import", "tsx", "/trusted/temperature-unit.ts"]); } catch { failures.push("focused_unit_failed"); }
  try { await run("node", ["/runtime/node_modules/next/dist/bin/next", "build", "--webpack"]); } catch { failures.push("production_build_failed"); }
  try { await run("node", ["/runtime/node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]); } catch { failures.push("typecheck_failed"); }
  if (!failures.length) {
    const server = spawn("node", ["/runtime/node_modules/next/dist/bin/next", "start", "--port", "3001"], { cwd: "/candidate", uid: 65532, gid: 65532, detached: true, env: { PATH: process.env.PATH, HOME: "/tmp", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore" });
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await fetch("http://127.0.0.1:3001/api/version").then(response => response.ok).catch(() => false)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const result = await verifyWeather({ url: "http://127.0.0.1:3001", allowedHosts: [], allowLocalhost: true, expectedProvenance, runId: "sandbox-candidate", outputDir: "/evidence" });
      if (!result.identityPassed) failures.push("provenance_mismatch");
      failures.push(...result.checks.filter(check => !check.passed).map(check => `${check.name}: expected ${check.expected}, observed ${check.actual}`));
    } catch { failures.push("protected_browser_failed"); }
    finally { if (server.pid) { try { process.kill(-server.pid, "SIGKILL"); } catch {} } }
  }
  } finally { await assignCandidateOwner("/candidate", Number(process.env.SANDBOX_RETURN_UID ?? "1000"), Number(process.env.SANDBOX_RETURN_GID ?? "1000"), false); }
  await writeFile("/evidence/verification.json", JSON.stringify({ passed: failures.length === 0, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
main().catch(() => { process.exitCode = 1; });
