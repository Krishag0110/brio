import { describe, expect, it, vi } from "vitest";
import { releaseExactCandidate, type ReleaseCandidate, type ReleaseProvider, type ReleaseState, type ReleaseStore } from "../../workers/engineering/release";

const baseSha = "a".repeat(40), headSha = "b".repeat(40), treeDigest = "c".repeat(40), mergeSha = "d".repeat(40);
function setup() {
  const candidate: ReleaseCandidate = { candidateId: "candidate-1", repository: "owner/weather", pullNumber: 1, baseSha, headSha, treeDigest, trustedTestRevision: "test-1", buildConfigRevision: "config-1", deploymentId: "dpl_candidate", deploymentUrl: "https://candidate.vercel.app", productionDomain: "weather.example.com", projectId: "project-1", goRef: "go-1", goExpiresAt: Date.now() + 60_000, replyBatchHash: "replies-1" };
  const data: { locked: boolean; state?: ReleaseState; main: { sha: string; tree: string }; production: string; merged: boolean; denied: boolean; livePassed: boolean } = { locked: false, main: { sha: baseSha, tree: "e".repeat(40) }, production: "dpl_previous", merged: false, denied: false, livePassed: true };
  const store: ReleaseStore = {
    acquire: vi.fn(async () => { if (data.locked) throw new Error("release_busy"); data.locked = true; return { lockId: "lock", state: data.state }; }),
    authorize: vi.fn(async () => { if (data.denied) throw new Error("go_revoked"); }),
    save: vi.fn(async (_lockId, state) => { data.state = structuredClone(state); }),
    release: vi.fn(async () => { data.locked = false; }), block: vi.fn(async () => {}),
  };
  const provider: ReleaseProvider = {
    currentMain: vi.fn(async () => data.main),
    pullHead: vi.fn(async () => ({ headSha, merged: data.merged, mergeSha: data.merged ? mergeSha : undefined })),
    verifyChecks: vi.fn(async () => {}),
    mergeExpectedHead: vi.fn(async () => { data.main = { sha: mergeSha, tree: treeDigest }; data.merged = true; return { mergeSha }; }),
    commitTree: vi.fn(async () => data.main.tree),
    deployment: vi.fn(async () => ({ id: candidate.deploymentId, projectId: candidate.projectId, target: "production", state: "READY", metadata: { candidateId: candidate.candidateId, headSha, treeDigest, trustedTestRevision: "test-1", buildConfigRevision: "config-1" } })),
    currentProduction: vi.fn(async () => data.production),
    promote: vi.fn(async (_project, deployment) => { data.production = deployment; }),
    verifyLive: vi.fn(async () => ({ passed: data.livePassed, evidenceRef: "evidence-live" })),
  };
  return { candidate, data, store, provider };
}
describe("approved deployment release and recovery", () => {
  it("rechecks exact-head provider checks before merge and promotion", async () => {
    const { candidate, provider, store } = setup();
    vi.mocked(provider.verifyChecks).mockResolvedValueOnce().mockRejectedValueOnce(new Error("protected_checks_changed"));
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("protected_checks_changed");
    expect(provider.mergeExpectedHead).toHaveBeenCalledOnce();
    expect(provider.promote).not.toHaveBeenCalled();
  });
  it("promotes the same approved deployment after expected-head merge and tree equality", async () => {
    const { candidate, provider, store } = setup(); const result = await releaseExactCandidate(candidate, store, provider);
    expect(result).toMatchObject({ stage: "live_verified", mergeSha, previousDeploymentId: "dpl_previous", liveEvidenceRef: "evidence-live" });
    expect(provider.mergeExpectedHead).toHaveBeenCalledExactlyOnceWith(candidate); expect(provider.promote).toHaveBeenCalledExactlyOnceWith(candidate.projectId, candidate.deploymentId);
  });
  it("no Go or expired Go causes zero merge/promotion", async () => {
    const { candidate, data, store, provider } = setup(); data.denied = true;
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("go_revoked");
    expect(provider.mergeExpectedHead).not.toHaveBeenCalled(); expect(provider.promote).not.toHaveBeenCalled();
    data.denied = false;
    await expect(releaseExactCandidate({ ...candidate, goExpiresAt: Date.now() - 1 }, store, provider)).rejects.toThrow("go_expired");
  });
  it("rejects head drift and different trees before promotion", async () => {
    const fixture = setup();
    vi.mocked(fixture.provider.pullHead).mockResolvedValue({ headSha: "f".repeat(40), merged: false });
    await expect(releaseExactCandidate(fixture.candidate, fixture.store, fixture.provider)).rejects.toThrow("candidate_head_drift");
    expect(fixture.provider.promote).not.toHaveBeenCalled();
    vi.mocked(fixture.provider.pullHead).mockResolvedValue({ headSha, merged: false });
    vi.mocked(fixture.provider.commitTree).mockResolvedValue("f".repeat(40));
    await expect(releaseExactCandidate(fixture.candidate, fixture.store, fixture.provider)).rejects.toThrow("merged_tree_mismatch");
    expect(fixture.data.state?.stage).toBe("merged"); expect(fixture.provider.promote).not.toHaveBeenCalled();
  });
  it("resumes after a crash after merge without merging again", async () => {
    const { candidate, data, store, provider } = setup();
    vi.mocked(provider.promote).mockRejectedValueOnce(new Error("provider_outage"));
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("provider_outage");
    expect(data.state?.stage).toBe("merged");
    expect((await releaseExactCandidate(candidate, store, provider)).stage).toBe("live_verified");
    expect(provider.mergeExpectedHead).toHaveBeenCalledOnce();
  });
  it("reconciles a lost merge receipt from provider state", async () => {
    const { candidate, data, store, provider } = setup();
    vi.mocked(provider.mergeExpectedHead).mockImplementationOnce(async () => { data.main = { sha: mergeSha, tree: treeDigest }; data.merged = true; throw new Error("receipt_lost"); });
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("receipt_lost");
    expect(data.state?.stage).toBe("prepared");
    expect((await releaseExactCandidate(candidate, store, provider)).stage).toBe("live_verified"); expect(provider.mergeExpectedHead).toHaveBeenCalledOnce();
  });
  it("reconciles a lost promotion receipt without promoting again", async () => {
    const { candidate, data, store, provider } = setup();
    vi.mocked(provider.promote).mockImplementationOnce(async () => { data.production = candidate.deploymentId; throw new Error("response_lost"); });
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("response_lost");
    expect((await releaseExactCandidate(candidate, store, provider)).stage).toBe("live_verified"); expect(provider.promote).toHaveBeenCalledOnce();
  });
  it("blocks repository drift during recovery and a changed production domain", async () => {
    const { candidate, data, store, provider } = setup();
    data.state = { candidateId: candidate.candidateId, stage: "merged", mergeSha, previousDeploymentId: "dpl_previous" };
    data.main = { sha: "f".repeat(40), tree: treeDigest };
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("repository_drift_after_merge");
    data.main = { sha: mergeSha, tree: treeDigest }; data.production = "dpl_unapproved";
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("production_drift"); expect(provider.promote).not.toHaveBeenCalled();
  });
  it("live behavioral failure stays promoted but never live_verified", async () => {
    const { candidate, data, store, provider } = setup(); data.livePassed = false;
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("live_verification_failed");
    expect(data.state?.stage).toBe("promoted"); expect(store.block).toHaveBeenCalledWith("lock", "live_verification_failed");
  });
  it("rejects a preview build as an approved staged production candidate", async () => {
    const { candidate, store, provider } = setup();
    const deployment = await provider.deployment(candidate.deploymentId);
    vi.mocked(provider.deployment).mockResolvedValue({ ...deployment, target: "preview" });
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("deployment_provenance_mismatch"); expect(provider.promote).not.toHaveBeenCalled();
  });
  it("serializes candidates with the durable release lock", async () => {
    const { candidate, data, store, provider } = setup(); data.locked = true;
    await expect(releaseExactCandidate(candidate, store, provider)).rejects.toThrow("release_busy"); expect(provider.mergeExpectedHead).not.toHaveBeenCalled();
  });
});
