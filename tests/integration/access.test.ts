import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, createAccessToken, hasControlAccess, localAccessAllowed, verifyAccessCode } from "../../src/server/access-token";
const now = 1_800_000_000_000;
const request = (token?: string, host = "app.example.com") => new Request(`https://${host}/api/control`, { headers: { host, ...(token ? { cookie: `${ACCESS_COOKIE}=${token}` } : {}) } });
const configure = () => { vi.stubEnv("FDE_DEMO_MODE", "false"); vi.stubEnv("FDE_LOCAL_ACCESS", "false"); vi.stubEnv("CONTROL_ACCESS_PASSWORD", "fixture-workspace-code"); vi.stubEnv("CONTROL_SERVICE_SECRET", "fixture-service-secret-32-characters-minimum"); };
afterEach(() => vi.unstubAllEnvs());
describe("hackathon access", () => {
  it("requires explicit local mode and both loopback URL and Host", () => {
    configure(); expect(localAccessAllowed(request(undefined, "localhost"))).toBe(false);
    vi.stubEnv("FDE_LOCAL_ACCESS", "true");
    expect(localAccessAllowed(request(undefined, "localhost"))).toBe(true);
    expect(localAccessAllowed(request())).toBe(false);
    expect(localAccessAllowed(new Request("http://localhost/", { headers: { host: "public.example" } }))).toBe(false);
  });
  it("never makes remotely hosted demo data accessible", () => {
    configure(); vi.stubEnv("FDE_DEMO_MODE", "true");
    expect(hasControlAccess(request(createAccessToken(now)), now)).toBe(false);
  });
  it("denies missing and incorrect codes, accepts exact configured code", () => {
    configure(); expect(verifyAccessCode(undefined)).toBe(false); expect(verifyAccessCode("wrong-code")).toBe(false);
    expect(verifyAccessCode("fixture-workspace-code")).toBe(true);
  });
  it("fails closed when secrets are missing or weak", () => {
    configure(); vi.stubEnv("CONTROL_SERVICE_SECRET", "short");
    expect(() => verifyAccessCode("fixture-workspace-code")).toThrow("access_configuration_required");
    expect(hasControlAccess(request(), now)).toBe(false);
  });
  it("rejects missing, tampered, expired and implausibly future cookies", () => {
    configure(); const token = createAccessToken(now);
    expect(hasControlAccess(request(token), now)).toBe(true);
    expect(hasControlAccess(request(), now)).toBe(false);
    expect(hasControlAccess(request(token.slice(0,-1) + (token.endsWith("a") ? "b" : "a")), now)).toBe(false);
    expect(hasControlAccess(request(token), now + ACCESS_TTL_SECONDS * 1000)).toBe(false);
    expect(hasControlAccess(request(createAccessToken(now + 1000)), now)).toBe(false);
    expect(hasControlAccess(request("malformed"), now)).toBe(false);
  });
  it("invalidates cookies when the shared code or service secret rotates", () => {
    configure(); const token = createAccessToken(now);
    vi.stubEnv("CONTROL_ACCESS_PASSWORD", "rotated-workspace-code"); expect(hasControlAccess(request(token), now)).toBe(false);
    configure(); vi.stubEnv("CONTROL_SERVICE_SECRET", "rotated-service-secret-32-characters-minimum"); expect(hasControlAccess(request(token), now)).toBe(false);
  });
});
