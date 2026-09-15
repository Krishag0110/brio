import { readControl, subscribeControl } from "@/server/control";
import { errorResponse } from "@/server/http";
import { snapshotStream } from "@/server/stream";
import { hostedDemoEnabled, runtimeConfig } from "@/server/config";
import { assertControlAccess } from "@/server/access";
import type { Snapshot } from "@/shared/control-contract";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    // Authorize before opening the stream, including the local demo boundary.
    const initial = await readControl(request) as Snapshot;
    const config = runtimeConfig();
    const reactive = (hostedDemoEnabled() || config.mode === "live") && config.accessConfigured && config.convexConfigured;
    return new Response(snapshotStream(initial, () => readControl(request), request.signal, reactive ? { validate: () => assertControlAccess(request), subscribe: (receive, failed) => subscribeControl(request, receive, failed) } : {}), { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  } catch (error) { return errorResponse(error); }
}
