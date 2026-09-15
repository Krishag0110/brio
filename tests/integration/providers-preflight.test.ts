import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureToken = "fixture-only-provider-token-123456789";
const fixtureSshKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-only-key\n-----END OPENSSH PRIVATE KEY-----";
const fixtureAppKey = "-----BEGIN RSA PRIVATE KEY-----\nfixture-only-app-key\n-----END RSA PRIVATE KEY-----";
const base: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  CONVEX_SITE_URL: "https://fixture.convex.site",
  ENGINEERING_GRANT_SECRET: "fixture-grant-secret-with-32-characters",
  ENGINEERING_CALLBACK_SECRET: "fixture-callback-secret-with-32-characters",
  CODING_SANDBOX_IMAGE: `fixture/image@sha256:${"a".repeat(64)}`,
  WEATHER_TARGET_REPOSITORY: "fixture/weather",
  WEATHER_PR_TOKEN: fixtureToken,
};

function inventory(credentials: Record<string, string>) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/preflight.ts", "--scope", "engineering", "--mode", "live", "--json", "--strict", "--no-env-files"],
    { cwd: resolve(import.meta.dirname, "../.."), env: { ...base, ...credentials }, encoding: "utf8", timeout: 10_000 },
  );
  if (result.error) throw result.error;
  expect(result.stderr).toBe("");
  for (const value of [fixtureToken, fixtureSshKey, fixtureAppKey]) expect(result.stdout).not.toContain(value);
  const report = JSON.parse(result.stdout) as {
    liveReadiness: string;
    networkRequests: number;
    secretValuesPrinted: boolean;
    checks: { id: string; status: string }[];
  };
  expect(report).toMatchObject({ liveReadiness: "unverified", networkRequests: 0, secretValuesPrinted: false });
  return { exit: result.status, statuses: Object.fromEntries(report.checks.map(row => [row.id, row.status])) };
}

describe("engineering credential inventory with isolated fixture environment", () => {
  it("accepts the preferred SSH deploy key and paired Checks App settings", () => {
    expect(inventory({ WEATHER_REPO_READ_SSH_KEY: fixtureSshKey, WEATHER_CHECKS_APP_ID: "12345", WEATHER_CHECKS_APP_PRIVATE_KEY: fixtureAppKey }).exit).toBe(0);
  });
  it("accepts optional checkout and supported check-token fallbacks", () => {
    expect(inventory({ WEATHER_REPO_READ_TOKEN: fixtureToken, WEATHER_CHECKS_TOKEN: fixtureToken }).exit).toBe(0);
  });
  it("recognizes writer runtime aliases without requiring reserved GitHub secret names", () => {
    expect(inventory({ WEATHER_PR_TOKEN: "", GITHUB_PR_TOKEN: fixtureToken, WEATHER_REPO_READ_SSH_KEY: fixtureSshKey, GITHUB_CHECKS_TOKEN: fixtureToken }).exit).toBe(0);
  });
  it("blocks checkout when both credential alternatives are absent", () => {
    expect(inventory({ WEATHER_CHECKS_TOKEN: fixtureToken })).toMatchObject({ exit: 1, statuses: { engineering_target_checkout: "missing" } });
  });
  it("blocks a configured App ID without its private key even when a fallback token exists", () => {
    expect(inventory({ WEATHER_REPO_READ_SSH_KEY: fixtureSshKey, WEATHER_CHECKS_APP_ID: "12345", WEATHER_CHECKS_TOKEN: fixtureToken })).toMatchObject({ exit: 1, statuses: { engineering_checks_writer: "invalid" } });
  });
  it("blocks a private App key with no App ID or token fallback", () => {
    expect(inventory({ WEATHER_REPO_READ_SSH_KEY: fixtureSshKey, WEATHER_CHECKS_APP_PRIVATE_KEY: fixtureAppKey })).toMatchObject({ exit: 1, statuses: { engineering_checks_writer: "invalid" } });
  });
  it("blocks missing protected-check capability independently of PR write", () => {
    expect(inventory({ WEATHER_REPO_READ_SSH_KEY: fixtureSshKey })).toMatchObject({ exit: 1, statuses: { engineering_checks_writer: "missing", engineering_pr_writer: "present_unverified" } });
  });
  it("blocks a malformed preferred SSH key instead of silently using the token", () => {
    expect(inventory({ WEATHER_REPO_READ_SSH_KEY: "malformed-key", WEATHER_REPO_READ_TOKEN: fixtureToken, WEATHER_CHECKS_TOKEN: fixtureToken })).toMatchObject({ exit: 1, statuses: { engineering_target_checkout: "invalid" } });
  });
});
