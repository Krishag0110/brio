/// <reference types="vite/client" />
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import workflow from "@convex-dev/workflow/test";
import schema from "../../convex/schema";
import { initialState } from "../../src/control/seed";
import { applyCommand, requestAuthority } from "../../src/control/reducer";
import { config } from "../../convex/state";
import { hashText } from "../../src/core/domain";
const modules = import.meta.glob("../../convex/**/*.ts");
const socialSecret = "social-test-secret-at-least-thirty-two-bytes";
const engineeringSecret = "engineering-test-secret-different-thirty-two-bytes";
function setup() { vi.stubEnv("SOCIAL_CALLBACK_SECRET", socialSecret); vi.stubEnv("ENGINEERING_CALLBACK_SECRET", engineeringSecret); const t = convexTest(schema, modules); agent.register(t); workflow.register(t); return t; }
function callback(body: string, kind = "social", timestamp = String(Date.now()), secret = socialSecret) { return { method: "POST", body, headers: { "content-type": "application/json", "x-worker-kind": kind, "x-worker-timestamp": timestamp, "x-worker-signature": createHmac("sha256", secret).update(timestamp + "." + body).digest("hex") } }; }
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("signed HTTP callback boundaries", () => {
  it("rejects missing, stale and wrong-worker signatures before parsing commands", async () => {
    const t = setup();
    expect((await t.fetch("/worker/engineering-authorize", { method: "POST", body: "{}" })).status).toBe(403);
    expect((await t.fetch("/worker/engineering-authorize", callback("{}", "engineering"))).status).toBe(403);
    expect((await t.fetch("/worker/claim", callback("{}", "social", String(Date.now() - 120_000)))).status).toBe(403);
  });
  it("requires signed body bytes and separates engineering from social capabilities", async () => {
    const t = setup(), signed = callback("{}");
    expect((await t.fetch("/worker/claim", { ...signed, body: "{\"admin\":true}" })).status).toBe(403);
    expect((await t.fetch("/worker/model-proposal", signed)).status).toBe(403);
    expect((await t.fetch("/worker/claim", callback("{}", "engineering", String(Date.now()), engineeringSecret))).status).toBe(403);
  });
  it("valid authentication still cannot fabricate a job grant", async () => {
    const t = setup(); expect((await t.fetch("/worker/claim", callback(JSON.stringify({ grant: { operation: "publish_reply" } })))).status).toBe(409);
    expect(await t.run(ctx => ctx.db.query("workerLeases").collect())).toHaveLength(0);
  });
  it("unsigned Slack actions cannot approve a case", async () => {
    const t = setup(); expect((await t.fetch("/slack/interactions", { method: "POST", body: "payload=%7B%7D" })).status).toBe(403);
  });
});

describe("Slack decision replay against real controller mutations", () => {
  it("accepts exactly one bound engineer decision and rejects a conflicting replay", async () => {
    vi.useFakeTimers(); const t = setup(); vi.stubEnv("SLACK_SIGNING_SECRET", socialSecret); vi.stubEnv("SLACK_TEAM_ID", "T_fde"); vi.stubEnv("SLACK_CHANNEL_ID", "C_fde"); vi.stubEnv("SLACK_ENGINEER_USER_IDS", "U_engineer");
    let state = initialState(config());
    state = applyCommand(state, { action: "intake", platform: "x", mode: "fixture", text: "20°C becomes 20°F", sourceUrl: "" }, { id: "engineer", name: "Engineer", roles: ["engineer"] }, config());
    const authority = requestAuthority(state, "build", state.cases[0].id, undefined, Date.now());
    await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state }));
    async function post(action: string, bindingHash = hashText(authority.request.binding)) {
      const body = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", team: { id: "T_fde" }, channel: { id: "C_fde" }, user: { id: "U_engineer" }, actions: [{ action_id: "fde_" + action, value: JSON.stringify({ authorityId: authority.request.requestId, caseId: state.cases[0].id, bindingHash, action }) }] }) }).toString();
      const timestamp = String(Math.floor(Date.now() / 1000));
      return t.fetch("/slack/interactions", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": timestamp, "x-slack-signature": "v0=" + createHmac("sha256", socialSecret).update("v0:" + timestamp + ":" + body).digest("hex") } });
    }
    expect((await (await post("build", "wrong-binding")).json()).text).toContain("rejected");
    expect((await (await post("build")).json()).text).toContain("recorded");
    expect((await (await post("build")).json()).text).toContain("recorded");
    expect((await (await post("no_build")).json()).text).toContain("rejected");
    const saved = await t.run(async ctx => (await ctx.db.query("controlStates").first())!.state);
    expect(saved.authorities[0].request.status).toBe("approved");
    expect(saved.tasks.filter((task: {kind:string}) => task.kind === "build_candidate")).toHaveLength(1);
  });
});
