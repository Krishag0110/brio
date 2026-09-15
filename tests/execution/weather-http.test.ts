import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { callbackSignature } from "../../workers/shared/security";
import { createWeatherVerificationServer } from "../../workers/engineering/weather-service";
import type { Provenance, WeatherEvidence } from "../../workers/engineering/protected-weather";

const secret = "fixture-engineering-verify-secret-32-bytes";
const provenance: Provenance = { schemaVersion: 1, runId: "run", candidateId: "candidate", headSha: "a".repeat(40), treeDigest: "b".repeat(40), trustedTestRevision: "weather-protected-v1", buildConfigRevision: "config-v1", mode: "live" };
const evidence: WeatherEvidence = { suiteVersion: "weather-protected-v1", runId: "request", url: "https://weather.example.com", mode: "live", timestamp: Date.now(), identityPassed: true, checks: [{ name: "20 C", expected: "68°F", actual: "68°F", passed: true }], screenshots: [], status: "passed", seededDefectReproduced: false, provenance };
const servers: ReturnType<typeof createWeatherVerificationServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function fixture() {
  const verify = vi.fn(async () => structuredClone(evidence)), fetcher = vi.fn(async () => Response.json(provenance));
  const server = createWeatherVerificationServer({ verifySecret: secret, allowedHosts: ["weather.example.com"] }, { verify, fetch: fetcher }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/weather/verify`;
  const send = (body: unknown, signed = true) => { const raw = JSON.stringify(body), timestamp = String(Date.now()); return fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-worker-timestamp": timestamp, "x-worker-signature": signed ? callbackSignature(raw, timestamp, secret) : "forged" }, body: raw }); };
  return { verify, fetcher, send };
}
it("weather worker requires authentic engineering signatures and exact allowed hosts", async () => {
  const { verify, send } = await fixture(); const body = { requestId: "request", mode: "live", url: "https://weather.example.com", expectedProvenance: provenance };
  expect((await send(body, false)).status).toBe(401); expect((await send({ ...body, url: "http://169.254.169.254/latest" })).status).toBe(403); expect(verify).not.toHaveBeenCalled();
  expect((await send(body)).status).toBe(200); expect(verify).toHaveBeenCalledOnce();
});
it("candidate/live checks cannot omit approved provenance", async () => {
  const { send, verify } = await fixture(); expect((await send({ requestId: "request", mode: "candidate", url: "https://weather.example.com" })).status).toBe(400); expect(verify).not.toHaveBeenCalled();
});
it("baseline discovery never claims an approved deployment identity", async () => {
  const { send, fetcher } = await fixture(); const response = await send({ requestId: "request", mode: "baseline", url: "https://weather.example.com" });
  expect(await response.json()).toMatchObject({ status: "failed", identityPassed: false, identityAssurance: "observed_only" }); expect(fetcher).toHaveBeenCalledOnce();
});
