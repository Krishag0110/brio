import { type PublicationResult, type PublisherAdapter, type PublishRequest, publishSchema } from "../shared/contracts";
import { sha256 } from "../shared/security";

/** Fault injection only. Receipts intentionally use fixture:// and can never prove a live send. */
export class SimulatorPublisher implements PublisherAdapter {
  private receipts = new Map<string, PublicationResult>();
  async publish(input: PublishRequest, authorizeAtDispatch: () => Promise<void>): Promise<PublicationResult> {
    const request = publishSchema.parse(input);
    if (request.mode !== "fixture" || request.platform !== "simulator") throw new Error("fixture_live_mismatch");
    if (sha256(request.text) !== request.textHash) throw new Error("text_hash_mismatch");
    const existing = this.receipts.get(request.publicationId);
    if (existing) return existing;
    if (request.fault === "before_send" || request.fault === "deleted_target") return { status: "definitely_not_sent", mode: "fixture", reason: request.fault, retryable: request.fault === "before_send", completedAt: Date.now() };
    await authorizeAtDispatch();
    const result: PublicationResult = { status: "confirmed", mode: "fixture", providerReceipt: { id: `fixture:${request.publicationId}`, url: `fixture://publication/${encodeURIComponent(request.publicationId)}`, accountId: request.accountId, targetId: request.targetId, textHash: request.textHash }, completedAt: Date.now() };
    this.receipts.set(request.publicationId, result);
    if (request.fault === "after_send") return { status: "unknown", mode: "fixture", reason: "simulated_response_lost_after_send", retryable: false, completedAt: Date.now() };
    return result;
  }
  async reconcile(request: PublishRequest): Promise<PublicationResult> {
    if (request.mode !== "fixture") throw new Error("fixture_live_mismatch");
    return this.receipts.get(request.publicationId) ?? { status: "unknown", mode: "fixture", reason: "no_receipt_in_simulator_instance", retryable: false, completedAt: Date.now() };
  }
}
