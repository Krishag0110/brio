import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Command } from "../../src/control/types";
import type { Snapshot } from "../../src/shared/control-contract";

const transport = vi.hoisted(() => ({
  http: vi.fn(), reactive: vi.fn(), query: vi.fn(), mutation: vi.fn(), action: vi.fn(),
  onUpdate: vi.fn(), unsubscribe: vi.fn(), close: vi.fn(), local: vi.fn(),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) { transport.http(url); }
    query = transport.query;
    mutation = transport.mutation;
    action = transport.action;
  },
  ConvexClient: class {
    constructor(url: string) { transport.reactive(url); }
    onUpdate = transport.onUpdate;
    close = transport.close;
    connectionState() { return { isWebSocketConnected: true }; }
  },
}));
vi.mock("../../src/server/persistence", () => ({ withLocalState: transport.local }));
// Route imports use Next's alias; retain the real implementations in this test.
vi.mock("@/server/control", () => import("../../src/server/control"));
vi.mock("@/server/config", () => import("../../src/server/config"));
vi.mock("@/server/http", () => import("../../src/server/http"));
vi.mock("@/server/access", () => import("../../src/server/access"));
vi.mock("@/server/stream", () => import("../../src/server/stream"));

import { ACCESS_COOKIE, createAccessToken } from "../../src/server/access-token";
import { hostedDemoEnabled, runtimeConfig } from "../../src/server/config";
import { mutateControl, readControl, subscribeControl } from "../../src/server/control";
import { GET as stream } from "../../src/app/api/control/stream/route";

const testSecret = "hosted-demo-routing-test-service-key-only";
const demoSnapshot = { mode: "demo", revision: 1, cases: [] } as unknown as Snapshot;
function request(options: { authorized?: boolean; origin?: string; signal?: AbortSignal } = {}) {
  const headers = new Headers();
  if (options.authorized !== false) headers.set("cookie", `${ACCESS_COOKIE}=${createAccessToken()}`);
  if (options.origin) headers.set("origin", options.origin);
  return new Request("https://recording.example/api/control", { headers, signal: options.signal });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FDE_HOSTED_DEMO", "true");
  vi.stubEnv("FDE_DEMO_MODE", "false");
  vi.stubEnv("FDE_LOCAL_ACCESS", "false");
  vi.stubEnv("CONTROL_SERVICE_SECRET", testSecret);
  vi.stubEnv("CONTROL_ACCESS_PASSWORD", "local-test-access-code-only");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test-demo.convex.cloud");
  transport.query.mockResolvedValue(demoSnapshot);
  transport.mutation.mockResolvedValue(demoSnapshot);
  transport.action.mockResolvedValue(demoSnapshot);
  transport.onUpdate.mockReturnValue(transport.unsubscribe);
  transport.close.mockResolvedValue(undefined);
  transport.local.mockResolvedValue(demoSnapshot);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("hosted demo routing", () => {
  it("uses demo behavior only for the explicit server flag", () => {
    expect(hostedDemoEnabled()).toBe(true);
    expect(runtimeConfig().mode).toBe("demo");
    vi.stubEnv("FDE_HOSTED_DEMO", "1");
    expect(runtimeConfig().mode).toBe("live");
    vi.stubEnv("FDE_DEMO_MODE", "true");
    expect(runtimeConfig().mode).toBe("demo");
  });

  it("reads the isolated Convex demo using the authenticated server credential", async () => {
    expect(await readControl(request())).toBe(demoSnapshot);
    const [reference, args] = transport.query.mock.calls[0];
    expect(getFunctionName(reference)).toBe("demoControl:getSnapshot");
    expect(args).toEqual({ serviceKey: testSecret });
    expect(transport.local).not.toHaveBeenCalled();
  });

  it.each(["demo_start", "manual_receipt"])("keeps %s out of live mutations and provider actions", async action => {
    const command = { action, caseId: "fixture-case" } as Command;
    await mutateControl(request(), command);
    const [reference, args] = transport.mutation.mock.calls[0];
    expect(getFunctionName(reference)).toBe("demoControl:dispatch");
    expect(args).toEqual({ command, serviceKey: testSecret });
    expect(transport.action).not.toHaveBeenCalled();
    expect(transport.local).not.toHaveBeenCalled();
  });

  it("requires the access cookie for reads, mutations and subscriptions", async () => {
    const denied = request({ authorized: false });
    await expect(readControl(denied)).rejects.toThrow("unauthorized");
    await expect(mutateControl(denied, { action: "demo_start" })).rejects.toThrow("unauthorized");
    expect(() => subscribeControl(denied, vi.fn(), vi.fn())).toThrow("unauthorized");
    expect(transport.http).not.toHaveBeenCalled();
    expect(transport.reactive).not.toHaveBeenCalled();
    expect(transport.local).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests even with an otherwise valid cookie", async () => {
    const denied = request({ origin: "https://attacker.example" });
    await expect(readControl(denied)).rejects.toThrow("cross_origin_denied");
    await expect(mutateControl(denied, { action: "demo_start" })).rejects.toThrow("cross_origin_denied");
    expect(transport.http).not.toHaveBeenCalled();
  });

  it("fails closed with no Convex URL instead of using filesystem state", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    await expect(readControl(request())).rejects.toThrow("configuration_required");
    await expect(mutateControl(request(), { action: "demo_start" })).rejects.toThrow("configuration_required");
    expect(() => subscribeControl(request(), vi.fn(), vi.fn())).toThrow("configuration_required");
    expect(transport.local).not.toHaveBeenCalled();
    expect(transport.http).not.toHaveBeenCalled();
    expect(transport.reactive).not.toHaveBeenCalled();
  });

  it("rejects incomplete access configuration without opening Convex", async () => {
    const previouslyAuthorized = request();
    vi.stubEnv("CONTROL_SERVICE_SECRET", "");
    await expect(readControl(previouslyAuthorized)).rejects.toThrow("unauthorized");
    expect(transport.http).not.toHaveBeenCalled();
    expect(transport.local).not.toHaveBeenCalled();
  });

  it("keeps plain local demo restricted to loopback", async () => {
    vi.stubEnv("FDE_HOSTED_DEMO", "false");
    vi.stubEnv("FDE_DEMO_MODE", "true");
    await expect(readControl(request())).rejects.toThrow("demo_loopback_only");
    await expect(mutateControl(request(), { action: "demo_start" })).rejects.toThrow("demo_loopback_only");
    expect(await readControl(new Request("http://127.0.0.1:3002/api/control"))).toBe(demoSnapshot);
    expect(transport.local).toHaveBeenCalledTimes(1);
    expect(transport.http).not.toHaveBeenCalled();
  });

  it("preserves the live snapshot and manual-receipt action when disabled", async () => {
    vi.stubEnv("FDE_HOSTED_DEMO", "false");
    await readControl(request());
    expect(getFunctionName(transport.query.mock.calls[0][0])).toBe("control:getSnapshot");
    await mutateControl(request(), { action: "manual_receipt", caseId: "live-case" } as Command);
    expect(getFunctionName(transport.action.mock.calls[0][0])).toBe("controlActions:recordManualReceipt");
    expect(transport.mutation).not.toHaveBeenCalled();
    const subscription = subscribeControl(request(), vi.fn(), vi.fn());
    expect(getFunctionName(transport.onUpdate.mock.calls[0][0])).toBe("control:getSnapshot");
    subscription.close();
  });

  it("streams Convex demo updates without a filesystem or polling fallback", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const response = await stream(request({ signal: abort.signal }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const [reference, args, receive] = transport.onUpdate.mock.calls[0];
    expect(getFunctionName(reference)).toBe("demoControl:getSnapshot");
    expect(args).toEqual({ serviceKey: testSecret });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // Retry interval.
    await reader.read(); // Authorized initial snapshot.
    receive({ ...demoSnapshot, revision: 2 });
    const update = decoder.decode((await reader.read()).value);
    expect(update).toContain('"revision":2');
    expect(update).not.toContain(testSecret);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.query).toHaveBeenCalledTimes(1);
    expect(transport.local).not.toHaveBeenCalled();
    abort.abort();
    await reader.cancel();
    expect(transport.unsubscribe).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("does not open a stream for an unauthorized request", async () => {
    const response = await stream(request({ authorized: false }));
    expect(response.status).toBe(403);
    expect(transport.onUpdate).not.toHaveBeenCalled();
  });
});
