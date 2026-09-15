import { makeFunctionReference } from "convex/server";
import { liveClient } from "@/server/control";
import { runtimeConfig } from "@/server/config";
import { errorResponse, readJson } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (runtimeConfig().mode === "demo") throw new Error("live_session_import_disabled_in_demo");
    const body = await readJson(request, 30000);
    const client = await liveClient(request);
    const { grant } = await client.action(makeFunctionReference<"action">("sessionActions:createImportGrant"), { accountId: body.accountId });
    if (!process.env.SOCIAL_WORKER_URL) throw new Error("configuration_required");
    const response = await fetch(new URL("/v1/sessions/import", process.env.SOCIAL_WORKER_URL), {
      method: "POST", headers: { "Content-Type": "application/json", Origin: process.env.CONTROL_APP_ORIGIN || new URL(request.url).origin },
      body: JSON.stringify({ grant, storageState: body.storageState }), signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error("session_import_failed");
    return Response.json({ ok: true, status: "Account session validated; platform permission remains separate." });
  } catch (e) { return errorResponse(e); }
}
