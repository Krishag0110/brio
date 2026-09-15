import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { liveClient } from "../../../../../server/control";
import { runtimeConfig } from "../../../../../server/config";
import { errorResponse, readJson } from "../../../../../server/http";
import { redditAccountSchema } from "../../../../../../workers/shared/reddit-contracts";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (runtimeConfig().mode === "demo") throw new Error("reddit_oauth_disabled_in_demo");
    const { accountId } = z.object({ accountId: redditAccountSchema }).strict().parse(await readJson(request, 1000));
    const client = await liveClient(request);
    if (!process.env.SOCIAL_WORKER_URL) throw new Error("configuration_required");
    const url = new URL("/v1/oauth/reddit/start", process.env.SOCIAL_WORKER_URL);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("configuration_required");
    const { grant } = await client.action(makeFunctionReference<"action">("sessionActions:createRedditGrant"), { accountId });
    // A top-level POST to the worker establishes its own host-only OAuth proof cookie.
    return Response.json({ url: url.href, grant }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
