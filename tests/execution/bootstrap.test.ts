import { describe, expect, it, vi } from "vitest";
import { assertBootstrapSource, BOOTSTRAP, type BootstrapReceipt, publishBootstrapCheck } from "../../workers/engineering/bootstrap";

const controllerSha = "c".repeat(40), treeDigest = "d".repeat(40);
const source = { repository: BOOTSTRAP.repository, baseSha: BOOTSTRAP.baseSha, headSha: BOOTSTRAP.headSha, changes: [...BOOTSTRAP.changes], originalTemperature: "seeded conversion", temperature: "seeded conversion", packageManager: "bun@1.4.2", bunVersion: "1.4.2\n", previousDependencies: { next: "16.3.5" }, dependencies: { next: "16.3.5" } };
const receipt: BootstrapReceipt = { kind: "reviewed_bun_bootstrap", repository: BOOTSTRAP.repository, pullNumber: 1, baseSha: BOOTSTRAP.baseSha, headSha: BOOTSTRAP.headSha, treeDigest, controllerSha, workflowRunId: "123", completedAt: new Date().toISOString(), checks: { sourceScope: true, bunFrozenInstall: true, build: true, typecheck: true, protectedBaseline: true }, weatherQa: { status: "failed", seededDefectReproduced: true, identityPassed: true, checkCount: 34 } };
const pr = { state: "open", merged: false, head: { sha: BOOTSTRAP.headSha, repo: { full_name: BOOTSTRAP.repository } }, base: { ref: "main", sha: BOOTSTRAP.baseSha, repo: { full_name: BOOTSTRAP.repository } } };
const input = { receipt, controllerSha, workflowRunId: "123", controllerRepository: "Aarush-Dubey/hackathon", readToken: "fixture-read", checksToken: "fixture-checks" };

describe("reviewed Bun bootstrap cannot become a general check-writing path", () => {
  it("accepts only the approved toolchain scope while preserving the defect", () => expect(() => assertBootstrapSource(source)).not.toThrow());
  it.each([
    { headSha: "f".repeat(40) }, { baseSha: "e".repeat(40) }, { repository: "other/weather" },
    { changes: [...BOOTSTRAP.changes, "M\tlib/temperature.ts"] }, { temperature: "a generated fix" },
    { packageManager: "bun@latest" }, { bunVersion: "1.4.3" }, { dependencies: { next: "99" } },
  ])("rejects unreviewed source or toolchain changes: %j", override => expect(() => assertBootstrapSource({ ...source, ...override })).toThrow());
  it("writes a truthful baseline check to the exact current head using a separate capability", async () => {
    const responses = [pr, { sha: BOOTSTRAP.headSha, tree: { sha: treeDigest } }, { id: 4, head_sha: BOOTSTRAP.headSha, conclusion: "success" }];
    const transport = vi.fn(async () => Response.json(responses.shift()));
    await expect(publishBootstrapCheck({ ...input, transport: transport as typeof fetch })).resolves.toMatchObject({ id: 4 });
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(String(calls[2][1].body));
    expect(body).toMatchObject({ name: "Protected weather", head_sha: BOOTSTRAP.headSha });
    expect(body.output.title).toContain("seeded weather defect retained");
    expect(body.output.summary).toContain("intentionally remains FAILED");
    expect(calls[2][1].headers).toMatchObject({ authorization: "Bearer fixture-checks" });
    expect(JSON.stringify(body)).not.toContain("fixture-checks");
  });
  it("refuses a changed PR head before creating any check", async () => {
    const transport = vi.fn(async () => Response.json({ ...pr, head: { ...pr.head, sha: "e".repeat(40) } }));
    await expect(publishBootstrapCheck({ ...input, transport: transport as typeof fetch })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("refuses artifacts from another workflow run before network access", async () => {
    const transport = vi.fn();
    await expect(publishBootstrapCheck({ ...input, workflowRunId: "456", transport })).rejects.toThrow("bootstrap_workflow_binding_mismatch");
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not accept passing weather QA as a seeded-bootstrap receipt", async () => {
    const transport = vi.fn();
    await expect(publishBootstrapCheck({ ...input, receipt: { ...receipt, weatherQa: { ...receipt.weatherQa, status: "passed" } }, transport })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
