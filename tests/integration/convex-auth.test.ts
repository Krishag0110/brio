/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import workflow from "@convex-dev/workflow/test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { config } from "../../convex/state";
import { initialState } from "../../src/control/seed";
import { applyCommand } from "../../src/control/reducer";
import { advanceDemoRun } from "../../src/control/demo-run";
import type { ControlState } from "../../src/control/types";

const modules = import.meta.glob("../../convex/**/*.ts");
const serviceKey = "auth-test-service-key-with-at-least-32-characters";

function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  workflow.register(t);
  return t;
}
async function seed(t: ReturnType<typeof setup>, workspaceId = "fde") {
  const state = initialState(config());
  state.workspaceId = workspaceId;
  await t.run((ctx) => ctx.db.insert("controlStates", { workspaceId, state }));
  return state;
}
async function persisted(t: ReturnType<typeof setup>, workspaceId = "fde") {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("controlStates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    return (row?.state as ControlState | undefined) ?? null;
  });
}

describe("Convex server-only control authorization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CONTROL_SERVICE_SECRET", serviceKey);
    vi.stubEnv("SLACK_TEAM_ID", "T_FDE");
    vi.stubEnv("SLACK_ENGINEER_USER_IDS", "U_ENGINEER");
    vi.stubEnv("SLACK_MARKETER_USER_IDS", "U_MARKETER");
    vi.stubEnv("FDE_DEMO_MODE", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network_calls_forbidden_in_auth_tests");
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects missing public service keys at the validated boundary", async () => {
    const t = setup();
    await expect(
      t.query(api.control.getSnapshot, {} as never),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.control.dispatch, {
        command: { action: "pause", paused: true },
      } as never),
    ).rejects.toThrow();
    expect(await persisted(t)).toBeNull();
  });

  it("rejects wrong keys on reads, commands, paid preview, import grants, and manual receipts", async () => {
    const t = setup();
    const wrong = { serviceKey: "wrong-service-key" };
    await expect(t.query(api.control.getSnapshot, wrong)).rejects.toThrow(
      "unauthorized",
    );
    await expect(
      t.mutation(api.control.dispatch, {
        ...wrong,
        command: { action: "pause", paused: true, reason: "Forged request" },
      }),
    ).rejects.toThrow("unauthorized");
    await expect(
      t.action(api.agents.preview, {
        ...wrong,
        persona: {},
        input: "Hello",
        context: "engagement",
        directInteraction: true,
      }),
    ).rejects.toThrow("unauthorized");
    await expect(
      t.action(api.sessionActions.createImportGrant, {
        ...wrong,
        accountId: "brand",
      }),
    ).rejects.toThrow("unauthorized");
    await expect(
      t.action(api.controlActions.recordManualReceipt, {
        ...wrong,
        command: { action: "manual_receipt" },
      }),
    ).rejects.toThrow("unauthorized");
    expect(await persisted(t)).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("workerGrants").collect()),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "short"])(
    "fails closed when the configured service secret is invalid (%j)",
    async (configured) => {
      vi.stubEnv("CONTROL_SERVICE_SECRET", configured);
      const t = setup();
      await expect(
        t.query(api.control.getSnapshot, { serviceKey: configured }),
      ).rejects.toThrow("unauthorized");
      expect(await persisted(t)).toBeNull();
    },
  );

  it("ignores claimed identities and roles when the service key is absent or wrong", async () => {
    const t = setup();
    const claims = t.withIdentity({
      subject: "forged-admin",
      issuer: "https://identity.example.test",
      roles: ["admin", "engineer", "marketer"],
      workspaceId: "fde",
    });
    await expect(
      claims.query(api.control.getSnapshot, { serviceKey: "wrong" }),
    ).rejects.toThrow("unauthorized");
    expect(await persisted(t)).toBeNull();
  });

  it("uses the fixed hackathon operator and never returns the service credential", async () => {
    const t = setup();
    const result = await t.query(api.control.getSnapshot, { serviceKey });
    expect(result.mode).toBe("live");
    expect(result.actor).toEqual({
      id: "hackathon-operator",
      name: "Hackathon operator",
      roles: ["engineer", "marketer", "admin"],
    });
    expect(JSON.stringify(result)).not.toContain(serviceKey);
    expect(result.actor).not.toHaveProperty("slackUserId");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates an old key after server secret rotation", async () => {
    const t = setup();
    await t.query(api.control.getSnapshot, { serviceKey });
    vi.stubEnv(
      "CONTROL_SERVICE_SECRET",
      "rotated-service-key-with-at-least-32-characters",
    );
    await expect(
      t.query(api.control.getSnapshot, { serviceKey }),
    ).rejects.toThrow("unauthorized");
  });

  it.each([
    ["internal_decide", "forbidden"],
    ["internal_pump", "forbidden"],
    ["demo_role", "demo_only"],
    ["demo_decide", "demo_only"],
    ["demo_advance", "demo_only"],
    ["demo_fault", "demo_only"],
    ["demo_start", "demo_only"],
    ["demo_pause", "demo_only"],
    ["demo_resume", "demo_only"],
    ["demo_restart", "demo_only"],
    ["internal_demo_step", "forbidden"],
  ])(
    "rejects public %s even with valid service access",
    async (action, reason) => {
      const t = setup();
      await expect(
        t.mutation(api.control.dispatch, {
          serviceKey,
          command: {
            action,
            decision: "approved",
            role: "engineer",
            fault: "checks_failed",
            internal: true,
            mode: "demo",
          },
        }),
      ).rejects.toThrow(reason);
      expect(await persisted(t)).toBeNull();
    },
  );

  it("rejects demo run commands even when a persisted row incorrectly claims demo mode", async () => {
    const t = setup(), state = initialState({ ...config(), mode: "demo" });
    await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state }));
    for (const action of ["demo_start", "demo_pause", "demo_resume", "demo_restart"]) {
      await expect(t.mutation(api.control.dispatch, { serviceKey, command: { action } })).rejects.toThrow("demo_only");
      expect(await persisted(t)).toEqual(state);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a validated public projection whose query value does not change when only the clock changes", async () => {
    const t = setup(), now = 1_800_000_000_000, demoConfig = { ...config(), mode: "demo" as const };
    vi.setSystemTime(now);
    let state = applyCommand(initialState(demoConfig), { action: "demo_start" }, { id: "demo-marketer", name: "Demo marketer", roles: ["marketer"] }, demoConfig, now);
    while (state.demoRun!.stepIndex < 4) state = advanceDemoRun(state, demoConfig, state.demoRun!.nextAt!);
    state.mode = "live";
    await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state }));
    const before = await t.query(api.control.getSnapshot, { serviceKey });
    vi.setSystemTime(now + 10 * 24 * 60 * 60 * 1000);
    const after = await t.query(api.control.getSnapshot, { serviceKey });
    expect(after).toEqual(before); expect(before.revision).toBe(state.version);
    expect(before.demoRun).toBeUndefined(); expect(before.cases[0].approvals[0].expiresAt).toBeTypeOf("number");
    expect(before.cases[0].approvals[0]).not.toHaveProperty("expired");
    expect(before.cases[0]).not.toHaveProperty("activeJobId"); expect(before.cases[0]).not.toHaveProperty("baseSha");
    expect(before.cases[0].signals![0]).not.toHaveProperty("sourceKey");
    expect(before.connections[0]).not.toHaveProperty("permission");
    expect(before).not.toHaveProperty("authorities"); expect(before).not.toHaveProperty("tasks");
    expect(await persisted(t)).toEqual(state);
  });

  it("cannot change server-configured Slack roles through a workspace command", async () => {
    const t = setup();
    const before = await seed(t);
    await expect(
      t.mutation(api.control.dispatch, {
        serviceKey,
        command: {
          action: "role_mapping",
          userId: "imposter",
          slackTeamId: "T_FDE",
          slackUserId: "U_ENGINEER",
          roles: ["engineer", "marketer", "admin"],
        },
      }),
    ).rejects.toThrow("slack_roles_configured_server_side");
    expect(await persisted(t)).toEqual(before);
  });

  it("binds commands to the configured workspace and audits the fixed actor", async () => {
    const t = setup();
    await seed(t);
    const foreign = await seed(t, "other-workspace");
    await t.mutation(api.control.dispatch, {
      serviceKey,
      command: {
        action: "pause",
        workspaceId: "other-workspace",
        paused: true,
        reason: "Bound workspace test",
        actor: { id: "imposter", roles: [] },
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await persisted(t))?.paused).toBe(true);
    expect(await persisted(t, "other-workspace")).toEqual(foreign);
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ workspaceId: "fde", action: "pause" });
    expect(JSON.stringify(audit)).not.toContain("imposter");
    expect(JSON.stringify(audit)).not.toContain(serviceKey);
  });
});
