import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
const http = httpRouter();
const encoder = new TextEncoder();
async function signatureValid(secret: string | undefined, input: string, actual: string): Promise<boolean> {
  if (!secret || secret.length < 32 || !/^[a-f0-9]{64}$/.test(actual)) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(actual.match(/.{2}/g)!, n => parseInt(n, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(input));
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const worker = httpAction(async (ctx, req) => {
  try {
    const raw = await req.text(); if (encoder.encode(raw).length > 200_000) return response({ error: "payload_too_large" }, 413);
    const kind = req.headers.get("x-worker-kind"), timestamp = req.headers.get("x-worker-timestamp") ?? "", signature = req.headers.get("x-worker-signature") ?? "";
    if (!["social", "engineering"].includes(kind ?? "") || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > 60_000 || !await signatureValid(kind === "social" ? process.env.SOCIAL_CALLBACK_SECRET : process.env.ENGINEERING_CALLBACK_SECRET, timestamp + "." + raw, signature)) return response({ error: "invalid_signature" }, 403);
    const path = new URL(req.url).pathname.replace(/^\/worker\//, ""), data = JSON.parse(raw);
    if (kind === "engineering") {
      if (path === "engineering-authorize") return response(await ctx.runMutation(internal.workerControl.engineeringAuthorize, data));
      if (path === "model-proposal") return response(await ctx.runAction(internal.agents.propose, { request: data }));
      if (path === "engineering-result") return response(await ctx.runMutation(internal.workerControl.engineeringResult, data));
      return response({ error: "wrong_worker_audience" }, 403);
    }
    if (path.startsWith("engineering-") || path === "model-proposal") return response({ error: "wrong_worker_audience" }, 403);
    if (path === "authorize-send") return response(await ctx.runAction(internal.execution.authorizeSocialSend, { data }));
    if (path.startsWith("reddit/")) return response(await ctx.runMutation(internal.redditControl.callback, { path: path.slice("reddit/".length), data }));
    return response(await ctx.runMutation(internal.workerControl.callback, { path, data }));
  } catch { return response({ error: "worker_request_rejected" }, 409); }
});
for (const path of ["claim", "heartbeat", "result", "authorize-send", "session/quarantine", "session/activate", "session/reject", "reddit/start", "reddit/claim", "reddit/activate", "reddit/fail", "engineering-authorize", "model-proposal", "engineering-result"]) http.route({ path: "/worker/" + path, method: "POST", handler: worker });
http.route({ path: "/slack/interactions", method: "POST", handler: httpAction(async (ctx, req) => {
  try {
    const raw = await req.text(); if (encoder.encode(raw).length > 100_000) return response({ error: "payload_too_large" }, 413);
    const timestamp = req.headers.get("x-slack-request-timestamp") ?? "", signature = req.headers.get("x-slack-signature") ?? "";
    if (!Number.isFinite(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300_000 || !signature.startsWith("v0=") || !await signatureValid(process.env.SLACK_SIGNING_SECRET, "v0:" + timestamp + ":" + raw, signature.slice(3))) return response({ error: "invalid_signature" }, 403);
    const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "null");
    if (payload?.type !== "block_actions" || payload.team?.id !== process.env.SLACK_TEAM_ID || payload.channel?.id !== process.env.SLACK_CHANNEL_ID || !Array.isArray(payload.actions) || payload.actions.length !== 1) return response({ error: "slack_context_denied" }, 403);
    const button = payload.actions[0]; if (button.action_id === "fde_open_case") return response({});
    const value = JSON.parse(button.value);
    if (button.action_id !== "fde_" + value.action || !["build", "no_build", "go", "no_go", "activate", "reject", "approve_reply"].includes(value.action)) return response({ error: "invalid_action" }, 403);
    await ctx.runMutation(internal.control.slackDecision, { teamId: payload.team.id, userId: payload.user.id, authorityId: value.authorityId, bindingHash: value.bindingHash, decision: ["no_build", "no_go", "reject"].includes(value.action) ? "declined" : "approved" });
    return response({ text: "Decision recorded against the current approval." });
  } catch { return response({ response_type: "ephemeral", text: "Decision rejected: approval expired, changed, or your Slack identity is not mapped to the required role." }); }
}) });
export default http;
