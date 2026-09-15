import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { initialState } from "../../src/control/seed";
import { config } from "../../convex/state";
import type { ControlState } from "../../src/control/types";
import { costTotals } from "../../src/control/reducer";

const modules = import.meta.glob("../../convex/**/*.ts");
const reserve = makeFunctionReference<"mutation", { caseId: string; maximumUsd: number }, string>("control:reserve");
describe("transactional budget contention", () => {
  it.each(["project", "case"] as const)("concurrent reservations cannot exceed the %s ceiling and preserve unknown charges", async kind => {
    const t = convexTest(schema, modules), state = initialState(config());
    state.costs.push({ id: "unknown-earlier", caseId: "preview-shared", maximumUsd: 0.02, status: "unknown", createdAt: Date.now() });
    if (kind === "project") state.infrastructureCommittedUsd = 89.95;
    await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state }));
    const outcomes = await Promise.allSettled([t.mutation(reserve, { caseId: kind === "case" ? "preview-shared" : "engineering-a", maximumUsd: 0.02 }), t.mutation(reserve, { caseId: kind === "case" ? "preview-shared" : "engineering-b", maximumUsd: 0.02 })]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const persisted = await t.run(async ctx => (await ctx.db.query("controlStates").first())!.state as ControlState);
    expect(persisted.costs).toHaveLength(2); expect(persisted.costs[0].status).toBe("unknown"); expect(costTotals(persisted).committed).toBeLessThanOrEqual(90);
  });
});
