import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { provenanceSchema, verifyWeather } from "../../workers/engineering/protected-weather";

it("observes the actual seeded conversion defect, every regression, reload, and trusted identity in Chromium", async () => {
  const allocator = createServer();
  await new Promise<void>(resolve => allocator.listen(0, "127.0.0.1", resolve));
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>(resolve => allocator.close(() => resolve()));
  const repository = process.cwd(), weather = path.resolve(process.env.WEATHER_TARGET_PATH ?? path.join(repository, "../hackathon-weather")), next = path.join(weather, "node_modules/next/dist/bin/next");
  // Only committed/owned seeded source executes on the host. Generated candidates use Docker.
  const server = spawn(process.execPath, [next, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: weather, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore", detached: true });
  const url = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await fetch(`${url}/api/version`).then(response => response.ok).catch(() => false)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(ready).toBe(true);
    const expectedProvenance = provenanceSchema.parse(JSON.parse(await readFile(path.join(weather, "protected/provenance.json"), "utf8")));
    const evidence = await verifyWeather({ url, allowedHosts: [], allowLocalhost: true, expectedProvenance, outputDir: path.join(repository, "tests/execution/artifacts"), runId: "protected-baseline-browser" });
    expect(evidence.identityPassed).toBe(true);
    expect(evidence.seededDefectReproduced).toBe(true);
    // This test passes because the pre-fix failure is reproduced; the QA evidence itself remains failed.
    expect(evidence.status).toBe("failed"); expect(evidence.checks).toHaveLength(34);
    expect(evidence.checks.find(check => check.name === "pleasant Fahrenheit")).toMatchObject({ expected: "68°F", actual: "20°F", passed: false });
    expect(evidence.checks.find(check => check.name === "reload/default unit")?.passed).toBe(true);
    expect(evidence.checks.find(check => check.name === "extreme-cold Fahrenheit")?.passed).toBe(true);
  } finally {
    if (server.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  }
}, 45_000);
