import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import { initialState } from "../../src/control/seed";
import { applyCommand, requestAuthority, setApproved } from "../../src/control/reducer";
import { hashText } from "../../src/core/domain";
import type { ControlState, RuntimeConfig } from "../../src/control/types";
import { buildRequestSchema } from "../../workers/engineering/coding-runner";

const modules = {
  "../../convex/execution.ts": () => import("../../convex/execution"),
  "../../convex/control.ts": () => import("../../convex/control"),
  "../../convex/workerControl.ts": () => import("../../convex/workerControl"),
  "../../convex/_generated/server.js": () => import("../../convex/_generated/server.js"),
};
const grantSecret = "fixture-engineering-grant-secret-with-32-bytes";
const controllerSha = "b".repeat(40);
const config: RuntimeConfig = { mode: "demo", repository: "owned/weather", baseSha: "a".repeat(40), openaiConfigured: false, accessConfigured: false, convexConfigured: false, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
const engineer = { id: "engineer", name: "Engineer", roles: ["engineer" as const] };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  vi.stubEnv("GITHUB_DISPATCH_TOKEN", "fixture-dispatch-token");
  vi.stubEnv("GITHUB_CONTROLLER_REPOSITORY", "owned/controller");
  vi.stubEnv("GITHUB_CONTROLLER_BRANCH", "main");
  vi.stubEnv("GITHUB_CONTROLLER_SHA", controllerSha);
  vi.stubEnv("FDE_WEATHER_REPOSITORY", config.repository);
  vi.stubEnv("ENGINEERING_GRANT_SECRET", grantSecret);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function dispatchApprovedBuild() {
  let state = applyCommand(initialState(config), { action: "intake", mode: "fixture", platform: "x", sourceUrl: "https://x.com/customer/status/123", text: "20°C becomes 20°F. The temperature conversion is broken." }, engineer, config, Date.now() - 1000);
  // Seed completed investigation evidence, then exercise the actual live approval/dispatch path.
  state.mode = "live";
  const c = state.cases[0]; c.sourceMode = "manual"; c.linearId = "fixture-linear-issue";
  c.evidence.push({ id: "linear-fixture", label: "Linear engineering issue", detail: "Fixture issue", url: "https://linear.app/owned/issue/WTH-1" });
  const authority = requestAuthority(state, "build", c.id, undefined, Date.now() - 500);
  setApproved(state, authority, engineer, "approved", Date.now() - 100);
  const task = state.tasks.find(item => item.kind === "build_candidate")!;
  task.status = "running"; task.dispatchedAt = Date.now();
  const t = convexTest(schema, modules);
  await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state: JSON.parse(JSON.stringify(state)) }));
  const transport = vi.fn(async (url: string | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.github.com/repos/owned/controller/actions/workflows/restricted-coding.yml/dispatches");
    expect(init?.method).toBe("POST");
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", transport);
  await t.action(internal.execution.execute, { taskId: task.id, attemptId: task.attemptId });
  state = await t.query(internal.control.stateForAction, {});
  const saved = state.tasks.find(item => item.id === task.id)!;
  expect(saved.error).toBeUndefined();
  expect(transport).toHaveBeenCalledTimes(1);
  const dispatch = JSON.parse(String(transport.mock.calls[0][1]?.body));
  const build = buildRequestSchema.parse(JSON.parse(Buffer.from(dispatch.inputs.build_request_base64, "base64").toString("utf8")));
  return { t, state, authority, task: saved, dispatch, build };
}

describe("engineering approval through signed GitHub dispatch", () => {
  it("persists and dispatches a build accepted by the same scope validator used by the runner", async () => {
    const { t, authority, task, dispatch, build } = await dispatchApprovedBuild();
    expect(task.status).toBe("running");
    expect(task.payload.buildRequest).toEqual(build);
    expect(build.scopeHash).toBe(hashText(authority.request.binding));
    expect(build.trustedControllerSha).toBe(controllerSha);
    expect(dispatch.ref).toBe("main");
    expect(dispatch.inputs.build_request_signature).toBe(createHmac("sha256", grantSecret).update(dispatch.inputs.build_request_base64).digest("hex"));
    for (const effect of ["model", "verify", "write_pr"]) {
      await expect(t.mutation(internal.workerControl.engineeringAuthorize, { build, effect })).resolves.toEqual({ allowed: true });
    }
  });

  it("rejects a changed dispatch and invalidates a previously bound build when approved scope changes", async () => {
    const { t, state, build } = await dispatchApprovedBuild();
    await expect(t.mutation(internal.workerControl.engineeringAuthorize, { build: { ...build, scopeHash: "c".repeat(64) }, effect: "model" })).rejects.toThrow("engineering_scope_denied");
    await t.run(async ctx => {
      const row = await ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", state.workspaceId)).unique();
      const changed = row!.state as ControlState;
      changed.cases[0].scope = ["lib/another-file.ts"];
      await ctx.db.patch(row!._id, { state: changed });
    });
    await expect(t.mutation(internal.workerControl.engineeringAuthorize, { build, effect: "model" })).rejects.toThrow("build_authority_invalid");
  });
});
