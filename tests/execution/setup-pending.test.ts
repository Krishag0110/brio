import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createSetupPendingServer } from "../../workers/shared/setup-pending";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
async function start(worker: "social" | "verifier") {
  const server = createSetupPendingServer(worker); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_listen_failed");
  return `http://127.0.0.1:${address.port}`;
}
describe("pending worker admission", () => {
  it.each(["social", "verifier"] as const)("reports %s as running but explicitly not ready", async worker => {
    const response = await fetch(`${await start(worker)}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "setup_pending", ready: false, worker });
  });
  it.each(["/v1/jobs", "/v1/sessions/import", "/v1/weather/verify"])("rejects %s before any provider work", async route => {
    const response = await fetch(`${await start("social")}${route}`, { method: "POST", body: JSON.stringify({ secret: "fixture-not-for-output" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "worker_setup_pending" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
