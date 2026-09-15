import { describe, expect, it } from "vitest";
import {
  applyCommand,
  costTotals,
  reserveModelCost,
  snapshot,
} from "../../src/control/reducer";
import { initialState } from "../../src/control/seed";
import type {
  Actor,
  Command,
  ControlState,
  RuntimeConfig,
} from "../../src/control/types";

const config: RuntimeConfig = {
  mode: "demo",
  repository: "owned/weather",
  baseSha: "base-v1",
  openaiConfigured: false,
  accessConfigured: false,
  convexConfigured: false,
  slackConfigured: false,
  linearConfigured: false,
  githubConfigured: false,
  vercelConfigured: false,
  workerConfigured: false,
  redditConfigured: false,
};
const admin: Actor = { id: "admin", name: "Administrator", roles: ["admin"] };
const engineer: Actor = {
  id: "engineer",
  name: "Engineer",
  roles: ["engineer"],
};
const marketer: Actor = {
  id: "marketer",
  name: "Marketer",
  roles: ["marketer"],
};
const now = 1_800_000_000_000;
function run(state: ControlState, command: Command, actor: Actor, offset = 10) {
  return applyCommand(
    state,
    command,
    actor,
    { ...config, mode: state.mode },
    now + offset,
  );
}
function ready() {
  let state = run(
    initialState(config),
    {
      action: "intake",
      platform: "x",
      mode: "fixture",
      sourceUrl: "https://x.com/customer/status/76543",
      text: "20°C becomes 20°F. The temperature toggle is broken.",
    },
    marketer,
  );
  const caseId = state.cases[0].id;
  state = run(state, { action: "demo_advance", caseId }, engineer);
  state = run(
    state,
    {
      action: "demo_decide",
      approvalId: state.authorities.find((a) => a.request.kind === "build")!
        .request.requestId,
      decision: "approved",
    },
    engineer,
  );
  state = run(state, { action: "demo_advance", caseId }, engineer);
  state = run(
    state,
    {
      action: "demo_decide",
      approvalId: state.authorities.find(
        (a) => a.request.kind === "candidate_go",
      )!.request.requestId,
      decision: "approved",
    },
    marketer,
  );
  return run(state, { action: "demo_advance", caseId }, marketer);
}

describe("operator budget commitments", () => {
  it("records a bounded admin commitment and audits reductions with a reason", () => {
    let state = run(
      initialState(config),
      {
        action: "budget_commit",
        usd: 35,
        reason: "Hosting and verifier maximum commitment",
      },
      admin,
    );
    expect(costTotals(state)).toEqual({
      spent: 0,
      reserved: 35,
      committed: 35,
    });
    expect(
      snapshot(state, admin, config).workspace.infrastructureCommittedUsd,
    ).toBe(35);
    expect(state.audit[0].detail).toContain("$0.00 to $35.00");
    expect(() =>
      run(state, { action: "budget_commit", usd: 0, reason: "" }, admin),
    ).toThrow();
    state = run(
      state,
      {
        action: "budget_commit",
        usd: 20,
        reason: "Cancelled unused service; final bill verified",
      },
      admin,
    );
    expect(state.infrastructureCommittedUsd).toBe(20);
    expect(state.audit[0].detail).toContain("$35.00 to $20.00");
    expect(state.tasks).toEqual([]);
  });

  it("rejects wrong roles, invalid amounts, and commitments beyond the shared ceiling", () => {
    const state = initialState(config);
    for (const actor of [engineer, marketer])
      expect(() =>
        run(
          state,
          { action: "budget_commit", usd: 1, reason: "Attempted change" },
          actor,
        ),
      ).toThrow("forbidden");
    for (const usd of [Number.NaN, Number.POSITIVE_INFINITY, -1, 100.01, "25"])
      expect(() =>
        run(
          state,
          { action: "budget_commit", usd, reason: "Invalid amount" },
          admin,
        ),
      ).toThrow();
    reserveModelCost(state, "case-with-reservation", 1, now);
    expect(() =>
      run(
        state,
        {
          action: "budget_commit",
          usd: 100,
          reason: "Would exceed cap with reservation",
        },
        admin,
      ),
    ).toThrow("budget_ceiling_exceeded");
    expect(state.infrastructureCommittedUsd).toBe(0);
  });

  it("retains unknown reservations and blocks new paid work at the discretionary ceiling", () => {
    let state = initialState(config);
    state.costs.push({
      id: "unknown",
      caseId: "uncertain",
      maximumUsd: 1,
      status: "unknown",
      createdAt: now,
    });
    state = run(
      state,
      {
        action: "budget_commit",
        usd: 89,
        reason: "Record bounded infrastructure exposure",
      },
      admin,
    );
    expect(costTotals(state).committed).toBe(90);
    expect(() => reserveModelCost(state, "fresh-case", 0.01, now)).toThrow(
      "budget_exhausted",
    );
    expect(state.costs[0].status).toBe("unknown");
  });

  it("initializes a valid recorded commitment and fails invalid fresh live configuration", () => {
    expect(
      initialState({
        ...config,
        mode: "live",
        infrastructureCommittedUsd: 21.5,
      }).infrastructureCommittedUsd,
    ).toBe(21.5);
    for (const usd of [Number.NaN, Number.POSITIVE_INFINITY, -1, 101])
      expect(() =>
        initialState({
          ...config,
          mode: "live",
          infrastructureCommittedUsd: usd,
        }),
      ).toThrow("configuration_required:valid_infrastructure_commitment");
  });
});

describe("fresh production evidence requests", () => {
  it("refreshes demo evidence with an explicit fixture label and keeps communication pending", () => {
    const before = ready();
    before.cases[0].liveVerifiedAt = now - 600_000;
    const state = run(
      before,
      { action: "reverify_live", caseId: before.cases[0].id },
      marketer,
      20,
    );
    expect(state.cases[0].liveVerifiedAt).toBe(now + 20);
    expect(state.cases[0].evidence.at(-1)?.label).toBe(
      "Simulated live evidence refresh",
    );
    expect(state.cases[0].communicationStatus).toBe(
      before.cases[0].communicationStatus,
    );
    expect(state.cases[0].outcome).toBeUndefined();
    expect(state.cases[0].publications[0].receiptUrl).toBeUndefined();
    expect(state.tasks).toEqual(before.tasks);
    expect(state.authorities).toEqual(before.authorities);
  });

  it("live refresh queues one bound verification task and cannot invent refreshed evidence", () => {
    const before = ready();
    before.mode = "live";
    const caseId = before.cases[0].id,
      verifiedAt = before.cases[0].liveVerifiedAt;
    let state = run(before, { action: "reverify_live", caseId }, engineer, 30);
    state = run(state, { action: "reverify_live", caseId }, marketer, 31);
    const tasks = state.tasks.filter((task) => task.kind === "verify_live");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      caseId,
      status: "pending",
      inputRevision: before.cases[0].version,
      payload: {
        deploymentId: before.cases[0].candidate!.deploymentId,
        headSha: before.cases[0].candidate!.headSha,
        treeDigest: before.cases[0].candidate!.treeDigest,
      },
    });
    expect(state.cases[0].blockingReason).toBe("live_reverification_pending");
    expect(state.cases[0].liveVerifiedAt).toBe(verifiedAt);
    expect(state.cases[0].evidence).toEqual(before.cases[0].evidence);
    expect(state.authorities).toEqual(before.authorities);
  });

  it("requires an engineering or marketing role, current candidate, and resolved send outcomes", () => {
    const state = ready(),
      caseId = state.cases[0].id;
    expect(() =>
      run(state, { action: "reverify_live", caseId }, admin),
    ).toThrow("forbidden");
    state.paused = true;
    expect(() =>
      run(state, { action: "reverify_live", caseId }, engineer),
    ).toThrow("workspace_paused");
    state.paused = false;
    state.cases[0].publications[0].status = "unknown";
    expect(() =>
      run(state, { action: "reverify_live", caseId }, marketer),
    ).toThrow("reconciliation_required");
    state.cases[0].publications[0].status = "approved";
    state.cases[0].productionVerified = false;
    expect(() =>
      run(state, { action: "reverify_live", caseId }, engineer),
    ).toThrow("verified_production_candidate_required");
  });

  it("cannot renew a revoked approval by refreshing evidence", () => {
    const state = ready();
    const go = state.authorities.find(
      (a) => a.request.kind === "candidate_go",
    )!;
    go.request.status = "revoked";
    const updated = run(
      state,
      { action: "reverify_live", caseId: state.cases[0].id },
      marketer,
    );
    expect(
      updated.authorities.find(
        (a) => a.request.requestId === go.request.requestId,
      )?.request.status,
    ).toBe("revoked");
    expect(updated.cases[0].blockingReason).toBeTruthy();
    expect(updated.cases[0].publications[0].receiptUrl).toBeUndefined();
  });
});

describe("fresh Build request", () => {
  function awaitingBuild() {
    let state = run(
      initialState(config),
      {
        action: "intake",
        platform: "x",
        mode: "fixture",
        sourceUrl: "https://x.com/customer/status/98765",
        text: "20°C becomes 20°F when toggled",
      },
      marketer,
    );
    state = run(
      state,
      { action: "demo_advance", caseId: state.cases[0].id },
      engineer,
    );
    return state;
  }
  it("replaces expired Build authority with a pending request without authorizing execution", () => {
    const before = awaitingBuild(),
      original = before.authorities[0];
    original.request.expiresAt = now - 1;
    const state = run(
      before,
      { action: "request_build", caseId: before.cases[0].id },
      engineer,
    );
    expect(
      state.authorities.find(
        (a) => a.request.requestId === original.request.requestId,
      )?.request.status,
    ).toBe("revoked");
    expect(
      state.authorities.filter(
        (a) => a.request.kind === "build" && a.request.status === "pending",
      ),
    ).toHaveLength(1);
    expect(state.cases[0].phase).toBe("AWAITING_BUILD");
    expect(
      state.tasks.filter((task) => task.kind === "build_candidate"),
    ).toEqual([]);
  });
  it("rejects wrong roles, wrong phase, and duplicate still-current Build requests", () => {
    const state = awaitingBuild(),
      caseId = state.cases[0].id;
    for (const actor of [admin, marketer])
      expect(() =>
        run(state, { action: "request_build", caseId }, actor),
      ).toThrow("forbidden");
    expect(() =>
      run(state, { action: "request_build", caseId }, engineer),
    ).toThrow("current_build_approval_exists");
    state.cases[0].phase = "BUILDING";
    expect(() =>
      run(state, { action: "request_build", caseId }, engineer),
    ).toThrow("build_request_phase_required");
  });
  it("requires trusted reproduction and Linear evidence in live before replacing missing authority", () => {
    const state = awaitingBuild(),
      caseId = state.cases[0].id;
    state.mode = "live";
    state.authorities = [];
    expect(() =>
      run(state, { action: "request_build", caseId }, engineer),
    ).toThrow("protected_reproduction_and_linear_required");
    state.cases[0].linearId = "issue-verified";
    expect(() =>
      run(state, { action: "request_build", caseId }, engineer),
    ).toThrow("protected_reproduction_and_linear_required");
    state.cases[0].evidence.push({
      id: "protected",
      label: "Protected reproduction",
      detail: "Trusted verifier receipt retained",
    });
    const updated = run(state, { action: "request_build", caseId }, engineer);
    expect(updated.authorities).toHaveLength(1);
    expect(updated.authorities[0].request.status).toBe("pending");
    expect(updated.tasks.map((task) => task.kind)).toEqual(["slack_approval"]);
  });
});

describe("policy approval and case cancellation boundaries", () => {
  it("accepts a synthetic policy case identifier without treating it as a canceled case", () => {
    let state = run(
      initialState(config),
      { action: "persona_request_activation", personaId: "friendly" },
      marketer,
    );
    const policy = state.authorities.find(
      (authority) => authority.personaId === "friendly",
    )!;
    state = run(
      state,
      {
        action: "demo_decide",
        caseId: "policy:friendly",
        approvalId: policy.request.requestId,
        decision: "approved",
      },
      marketer,
    );
    expect(
      state.personas.find((persona) => persona.id === "friendly")?.status,
    ).toBe("active");
    expect(state.cases).toEqual([]);
    expect(state.audit[0]?.action).toBe("demo:demo_decide");
  });
});
