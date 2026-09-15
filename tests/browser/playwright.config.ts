import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  projects: [
    { name: "demo", testMatch: "control.spec.ts" },
    {
      name: "hosted-access",
      testMatch: "access.spec.ts",
      use: { baseURL: "http://127.0.0.1:3101" },
    },
  ],
  globalSetup: "./setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../artifacts/browser-report", open: "never" }],
  ],
  outputDir: "../../artifacts/browser-results",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command:
        "FDE_NEXT_DIST_DIR=.next-e2e FDE_LOCAL_ACCESS=true FDE_DEMO_MODE=true FDE_DEMO_DATA_PATH=.data/browser-tests.json bun run start --hostname 127.0.0.1 --port 3100",
      cwd: "../..",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "FDE_NEXT_DIST_DIR=.next-e2e bun run start --hostname 127.0.0.1 --port 3101",
      cwd: "../..",
      url: "http://127.0.0.1:3101/access",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        FDE_LOCAL_ACCESS: "false",
        FDE_DEMO_MODE: "false",
        CONTROL_ACCESS_PASSWORD: "browser-test-access-code",
        CONTROL_SERVICE_SECRET:
          "browser-test-service-key-with-at-least-32-characters",
        CONTROL_APP_ORIGIN: "http://127.0.0.1:3101",
        NEXT_PUBLIC_CONVEX_URL: "",
        SOCIAL_WORKER_URL: "",
      },
    },
  ],
});
