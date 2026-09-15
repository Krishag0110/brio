import { assertControlAccess } from "./access";
import { serviceSecret } from "./access-token";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { applyCommand, snapshot } from "../control/reducer";
import { initialState } from "../control/seed";
import type { Actor, Command } from "../control/types";
import { hostedDemoEnabled, runtimeConfig } from "./config";
import { assertLocalDemo } from "./http";
import { withLocalState } from "./persistence";
import { advanceDemoRun } from "../control/demo-run";
import type { Snapshot } from "../shared/control-contract";

export async function liveClient(request: Request) {
  assertControlAccess(request);
  if (!runtimeConfig().convexConfigured) throw new Error("configuration_required");
  const serviceKey = serviceSecret();
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  return {
    query: (reference: FunctionReference<"query">, args: Record<string, unknown>) => client.query(reference, { ...args, serviceKey }),
    mutation: (reference: FunctionReference<"mutation">, args: Record<string, unknown>) => client.mutation(reference, { ...args, serviceKey }),
    action: (reference: FunctionReference<"action">, args: Record<string, unknown>) => client.action(reference, { ...args, serviceKey }),
  };
}
export async function readControl(request: Request) {
  const config = runtimeConfig();
  if (hostedDemoEnabled()) {
    const client = await liveClient(request);
    return client.query(makeFunctionReference<"query">("demoControl:getSnapshot"), {});
  }
  if (config.mode === "demo") {
    assertLocalDemo(request, config);
    return withLocalState(config, (state) => {
      const next = advanceDemoRun(state, config, Date.now());
      return { state: next, value: snapshot(next, { id: "demo-" + next.demoRole, name: "Demo " + next.demoRole, roles: [next.demoRole] }, config) };
    });
  }
  assertControlAccess(request);
  if (!config.accessConfigured || !config.convexConfigured) {
    return snapshot(initialState(config), { id: "unconfigured", name: "Setup required", roles: [] }, config);
  }
  const client = await liveClient(request);
  return client.query(makeFunctionReference<"query">("control:getSnapshot"), {});
}
export async function mutateControl(request: Request, command: Command) {
  const config = runtimeConfig();
  if (hostedDemoEnabled()) {
    const client = await liveClient(request);
    return client.mutation(makeFunctionReference<"mutation">("demoControl:dispatch"), { command });
  }
  if (config.mode === "demo") {
    assertLocalDemo(request, config);
    return withLocalState(config, (state) => {
      const actor: Actor = { id: "demo-" + state.demoRole, name: "Demo " + state.demoRole, roles: [state.demoRole] };
      const next = applyCommand(state, command, actor, config);
      return { state: next, value: snapshot(next, { id: "demo-" + next.demoRole, name: "Demo " + next.demoRole, roles: [next.demoRole] }, config) };
    });
  }
  const client = await liveClient(request);
  if (command.action === "manual_receipt") return client.action(makeFunctionReference<"action">("controlActions:recordManualReceipt"), { command });
  return client.mutation(makeFunctionReference<"mutation">("control:dispatch"), { command });
}

/** Keep the Convex credential on the server while relaying native reactive query updates. */
export function subscribeControl(request: Request, receive: (value: Snapshot) => void, failed: () => void) {
  assertControlAccess(request);
  if (!runtimeConfig().convexConfigured) throw new Error("configuration_required");
  const serviceKey = serviceSecret();
  const client = new ConvexClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false });
  try {
    const namespace = hostedDemoEnabled() ? "demoControl" : "control";
    const unsubscribe = client.onUpdate(makeFunctionReference<"query">(`${namespace}:getSnapshot`), { serviceKey }, value => receive(value as Snapshot), failed);
    return { close: () => { unsubscribe(); void client.close(); }, connected: () => client.connectionState().isWebSocketConnected };
  } catch (error) { void client.close(); throw error; }
}
