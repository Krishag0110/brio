import { z } from "zod";
import { makeFunctionReference } from "convex/server";
import { localPreview } from "@/control/reducer";
import { liveClient, readControl } from "@/server/control";
import { runtimeConfig } from "@/server/config";
import { errorResponse, readJson } from "@/server/http";
import type { Persona, Snapshot } from "@/shared/control-contract";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = z.object({ persona: z.custom<Persona>(), input: z.string().min(1).max(4000), context: z.enum(["engagement", "resolution", "known_remedy"]).default("engagement"), directInteraction: z.boolean().default(true) }).parse(await readJson(request));
    const config = runtimeConfig();
    const state = await readControl(request) as Snapshot;
    if (!state.actor.roles.includes("marketer")) throw new Error("forbidden");
    if (config.mode === "demo") return Response.json({ ...localPreview(input.persona, input.input, input.context, input.directInteraction), mode: "fixture" });
    const client = await liveClient(request);
    return Response.json(await client.action(makeFunctionReference<"action">("agents:preview"), input));
  } catch (e) { return errorResponse(e); }
}
