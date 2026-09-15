import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { requireSecret, verifyCallback } from "../shared/security";
import { provenanceSchema, verifyWeather } from "./protected-weather";

export const weatherRequestSchema = z.object({ requestId: z.string().min(1).max(100), mode: z.enum(["baseline", "candidate", "live"]), url: z.string().url(), approvedHost: z.string().optional(), expectedProvenance: provenanceSchema.optional() }).strict();
export type WeatherRequest = z.infer<typeof weatherRequestSchema>;
export function createWeatherVerificationServer(config: { verifySecret: string; allowedHosts: string[]; allowLocalhost?: boolean; acceptSignedDeploymentHosts?: boolean; protectionBypass?: string }, dependencies: { verify?: typeof verifyWeather; fetch?: typeof fetch } = {}) {
  requireSecret(config.verifySecret, "ENGINEERING_VERIFY_SECRET");
  let busy = false;
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
    if (request.method === "GET" && request.url === "/health") return send(200, { status: "ok", implementation: "protected-weather-v1", configuredHosts: config.allowedHosts.length, busy });
    if (request.method !== "POST" || request.url !== "/v1/weather/verify") return send(404, { error: "not_found" });
    let outputDirectory: string | undefined;
    let ownsSlot = false;
    try {
      let raw = "";
      for await (const chunk of request) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 16_384) throw new Error("payload_too_large"); }
      const timestamp = request.headers["x-worker-timestamp"], signature = request.headers["x-worker-signature"];
      if (typeof timestamp !== "string" || typeof signature !== "string" || !verifyCallback(raw, timestamp, signature, config.verifySecret)) return send(401, { error: "invalid_verification_signature" });
      const input = weatherRequestSchema.parse(JSON.parse(raw)), url = new URL(input.url);
      const allowedHosts = [...config.allowedHosts];
      // This signed single-job hostname must come from controller-verified Vercel project metadata.
      if (config.acceptSignedDeploymentHosts && input.expectedProvenance && input.approvedHost === url.hostname) allowedHosts.push(input.approvedHost);
      const local = config.allowLocalhost && ["127.0.0.1", "localhost"].includes(url.hostname);
      if ((!local && (url.protocol !== "https:" || !allowedHosts.includes(url.hostname) || url.port)) || url.username || url.password || (!local && /^(?:localhost$|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|.*\.local$)/.test(url.hostname))) return send(403, { error: "weather_host_not_allowed" });
      if (input.mode !== "baseline" && (!input.expectedProvenance || input.expectedProvenance.mode !== "live")) return send(400, { error: "expected_live_provenance_required" });
      if (busy) return send(409, { error: "verifier_busy" });
      busy = true; ownsSlot = true;
      let expected = input.expectedProvenance;
      if (!expected) {
        const observed = await (dependencies.fetch ?? fetch)(new URL("/api/version", url), { redirect: "error", signal: AbortSignal.timeout(10_000), headers: config.protectionBypass ? { "x-vercel-protection-bypass": config.protectionBypass } : {} });
        if (!observed.ok) throw new Error("version_unavailable");
        expected = provenanceSchema.parse(await observed.json());
      }
      outputDirectory = await mkdtemp(path.join(os.tmpdir(), "fde-weather-qa-"));
      const evidence = await (dependencies.verify ?? verifyWeather)({ url: input.url, allowedHosts, allowLocalhost: config.allowLocalhost, expectedProvenance: expected, outputDir: outputDirectory, runId: input.requestId, protectionBypass: config.protectionBypass });
      if (!input.expectedProvenance) { evidence.identityPassed = false; evidence.identityAssurance = "observed_only"; evidence.status = "failed"; }
      else evidence.identityAssurance = "expected_matches";
      const artifacts = [];
      for (const screenshot of evidence.screenshots.slice(0, 2)) {
        const bytes = await readFile(screenshot); if (bytes.length > 1_000_000) throw new Error("artifact_size_limit");
        artifacts.push({ name: path.basename(screenshot), contentType: "image/png", base64: bytes.toString("base64") });
      }
      return send(200, { ...evidence, screenshots: evidence.screenshots.map(file => path.basename(file)), artifacts });
    } catch { return send(422, { error: "weather_verification_failed", retryable: true }); }
    finally { if (ownsSlot) busy = false; if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }); }
  });
}
