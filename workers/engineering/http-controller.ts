import { z } from "zod";
import { callbackSignature, requireSecret } from "../shared/security";
import type { BuildRequest, CodingAuthority, ModelBroker } from "./coding-runner";
import { patchSchema } from "./patch-guard";

/** Trusted broker calls stay outside candidate containers. Convex remains the budget/approval authority. */
export class EngineeringController implements CodingAuthority, ModelBroker {
  constructor(private readonly siteUrl: string, private readonly callbackSecret: string) {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password) throw new Error("configuration_required:CONVEX_SITE_URL");
    requireSecret(callbackSecret, "ENGINEERING_CALLBACK_SECRET");
  }
  async send(endpoint: string, value: unknown): Promise<unknown> {
    const body = JSON.stringify(value), timestamp = String(Date.now());
    const response = await fetch(new URL(`/worker/${endpoint}`, this.siteUrl), { method: "POST", headers: { "content-type": "application/json", "x-worker-kind": "engineering", "x-worker-timestamp": timestamp, "x-worker-signature": callbackSignature(body, timestamp, this.callbackSecret) }, body, signal: AbortSignal.timeout(endpoint === "model-proposal" ? 120_000 : 10_000), redirect: "error" });
    if (!response.ok) throw new Error(`engineering_controller_rejected:${response.status}`);
    return response.json();
  }
  async authorize(build: BuildRequest, effect: "model" | "verify" | "write_pr") {
    z.object({ allowed: z.literal(true) }).parse(await this.send("engineering-authorize", { build, effect }));
  }
  async propose(request: Parameters<ModelBroker["propose"]>[0]) {
    return z.object({ proposal: patchSchema, reservationId: z.string().min(1), model: z.literal("gpt-5-mini") }).parse(await this.send("model-proposal", request));
  }
}
