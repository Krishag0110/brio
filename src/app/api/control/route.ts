import { readControl, mutateControl } from "@/server/control";
import { errorResponse, readJson } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return Response.json(await readControl(request), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try { const command = await readJson(request); if (typeof command.action !== "string") throw new Error("action_required");
    return Response.json(await mutateControl(request, command as { action: string }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
