import { runtimeConfig } from "./config";
import type { RuntimeConfig } from "../control/types";

export function assertLocalDemo(request: Request, config = runtimeConfig()): void {
  if (config.mode !== "demo") throw new Error("demo_only");
  const hostname = new URL(request.url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) throw new Error("demo_loopback_only");
  const host = request.headers.get("host")?.split(":")[0];
  if (host && !["127.0.0.1", "localhost", "[", "::1"].includes(host)) throw new Error("demo_loopback_only");
  assertSameOrigin(request);
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin) {
    const parsedOrigin = new URL(origin);
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host") || requestUrl.host;
    if (parsedOrigin.host !== host || parsedOrigin.protocol !== requestUrl.protocol) throw new Error("cross_origin_denied");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new Error("cross_origin_denied");
}
export async function readJson(request: Request, maximumBytes = 40000): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) throw new Error("json_required");
  if (Number(request.headers.get("content-length") || 0) > maximumBytes) throw new Error("payload_too_large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) throw new Error("payload_too_large");
  const result = JSON.parse(body);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("json_object_required");
  return result;
}
export function errorResponse(error: unknown): Response {
  const raw = error instanceof Error ? error.message : "";
  const code = /^[a-z][a-z0-9_:-]{0,90}$/.test(raw) ? raw : "invalid_request";
  const status = /forbidden|denied|only|unauthorized/.test(code) ? 403 : /configuration|missing_credentials/.test(code) ? 503 : /budget/.test(code) ? 429 : 400;
  return Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
}
export function configReadiness(config: RuntimeConfig) { return Object.fromEntries(Object.entries(config).filter(([k]) => k.endsWith("Configured"))); }
