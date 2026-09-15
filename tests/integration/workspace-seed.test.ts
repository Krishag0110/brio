import { describe, expect, it } from "vitest";
import { seedWorkspace } from "../../src/control/workspace-seed";
import { initialState } from "../../src/control/seed";
import { runtimeConfig } from "../../src/server/config";
import { snapshot, applyCommand } from "../../src/control/reducer";
import { stageFor, STAGES } from "../../src/components/control/mend";
import { ApprovalRequestSchema } from "../../src/core/approvals";

const config = { ...runtimeConfig(), mode: "demo" as const, infrastructureCommittedUsd: 0 };
const now = Date.UTC(2026, 8, 14, 12);
const actor = { id: "test", name: "Test", roles: ["marketer" as const] };
describe("rich workspace seed", () => {
  it("fills every stage with consistent fixture conversations and no provider work", () => {
    const { state, added } = seedWorkspace(initialState(config), now);
    expect(added).toBe(36);
    expect(STAGES.every(stage => state.cases.some(c => stageFor(c) === stage))).toBe(true);
    expect(state.cases.reduce((n, c) => n + c.signals.length, 0)).toBe(165);
    expect(state.cases.every(c => c.sourceMode === "fixture" && c.signals.every(s => !s.hasValidTarget && s.sourceMode === "fixture"))).toBe(true);
    expect(new Set(state.sourceKeys).size).toBe(state.sourceKeys.length);
    expect(state.cases.flatMap(c => c.publications).every(p => p.mode === "fixture" && state.personas.some(persona => persona.id === p.personaId))).toBe(true);
    expect(state.tasks).toEqual([]); expect(state.costs).toEqual([]);
    expect(state.personas.every(p => p.status === "draft")).toBe(true);
    expect(state.connections.every(c => c.status === "access_pending")).toBe(true);
    expect(state.authorities.every(a => ApprovalRequestSchema.safeParse(a.request).success)).toBe(true);
    const view = snapshot(state, actor, config);
    expect(view.cases.filter(c => c.phase === "COMPLETED").every(c => c.publications.some(p => p.status === "confirmed"))).toBe(true);
    expect(view.cases.some(c => c.drafts?.some(d => d.text.includes("bruh")))).toBe(true);
    expect(new Set(state.cases.map(c => c.createdAt.slice(0,10))).size).toBeGreaterThanOrEqual(6);
  });
  it("preserves existing cases, runs, identities and revisions when rerun", () => {
    let existing = applyCommand(initialState(config), { action: "demo_start" }, actor, config, now);
    const oldCase = structuredClone(existing.cases[0]), oldRun = structuredClone(existing.demoRun);
    const before = structuredClone(existing);
    const first = seedWorkspace(existing, now);
    expect(existing).toEqual(before);
    expect(first.state.cases.find(c => c.id === oldCase.id)).toEqual(oldCase);
    expect(first.state.demoRun).toEqual(oldRun);
    expect(first.state.cases).toHaveLength(37);
    const second = seedWorkspace(first.state, now + 86400000);
    expect(second.added).toBe(0); expect(second.state).toEqual(first.state);
    existing = second.state;
    expect(existing.version).toBe(before.version + 1);
  });
  it("rejects live state without changing it", () => {
    const state = initialState({ ...config, mode: "live" });
    const before = structuredClone(state);
    expect(() => seedWorkspace(state, now)).toThrow("workspace_seed_demo_only");
    expect(state).toEqual(before);
  });
});
