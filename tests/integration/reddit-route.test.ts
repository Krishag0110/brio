import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/connections/reddit/start/route";

afterEach(() => vi.unstubAllEnvs());
const request = (origin = "https://mend.example", body = { accountId: "drizzle-123" }) => new Request("https://mend.example/api/connections/reddit/start", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
describe("Reddit setup route access boundary", () => {
  it("never issues live OAuth authority from demo mode", async () => {
    vi.stubEnv("FDE_DEMO_MODE", "true");
    const response = await POST(request()); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "reddit_oauth_disabled_in_demo" });
  });
  it("rejects unauthenticated callers and cross-origin setup requests", async () => {
    vi.stubEnv("FDE_DEMO_MODE", "false"); vi.stubEnv("FDE_LOCAL_ACCESS", "false"); vi.stubEnv("CONTROL_ACCESS_PASSWORD", "");
    expect((await POST(request())).status).toBe(403);
    const crossOrigin = await POST(request("https://untrusted.example")); expect(crossOrigin.status).toBe(403); expect(await crossOrigin.json()).toEqual({ error: "cross_origin_denied" });
  });
  it("rejects oversized input before issuing a grant", async () => {
    vi.stubEnv("FDE_DEMO_MODE", "false");
    const response = await POST(request(undefined, { accountId: "x".repeat(2000) })); expect(await response.json()).toEqual({ error: "payload_too_large" });
  });
});
