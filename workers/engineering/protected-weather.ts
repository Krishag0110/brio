import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { provenanceSchema, type Provenance } from "../shared/weather-contracts";
export { provenanceSchema, type Provenance } from "../shared/weather-contracts";

// Deliberately independent of candidate source and fixture module.
export const PROTECTED_SUITE_VERSION = "weather-protected-v1";
const regressions = [ ["pleasant", 20, 68], ["freezing", 0, 32], ["extreme-cold", -40, -40], ["boiling", 100, 212] ] as const;
export type WeatherEvidence = { suiteVersion: string; runId: string; url: string; mode: "fixture" | "live"; timestamp: number; provenance?: Provenance; identityPassed: boolean; identityAssurance?: "expected_matches" | "observed_only"; checks: { name: string; expected: string; actual: string; passed: boolean }[]; screenshots: string[]; status: "passed" | "failed"; seededDefectReproduced: boolean };

function validatedUrl(value: string, allowedHosts: string[], allowLocalhost: boolean): URL {
  const url = new URL(value);
  const local = allowLocalhost && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((!local && (url.protocol !== "https:" || !allowedHosts.includes(url.hostname))) || (local && !["http:", "https:"].includes(url.protocol)) || url.username || url.password || (!local && url.port)) throw new Error("weather_host_not_allowed");
  return url;
}
export async function verifyWeather(options: { url: string; allowedHosts: string[]; allowLocalhost?: boolean; expectedProvenance: Provenance; outputDir: string; runId: string; protectionBypass?: string }): Promise<WeatherEvidence> {
  const url = validatedUrl(options.url, options.allowedHosts, options.allowLocalhost ?? false);
  const evidence: WeatherEvidence = { suiteVersion: PROTECTED_SUITE_VERSION, runId: options.runId, url: url.origin, mode: options.expectedProvenance.mode, timestamp: Date.now(), identityPassed: false, checks: [], screenshots: [], status: "failed", seededDefectReproduced: false };
  await mkdir(options.outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const deadline = setTimeout(() => { void browser.close(); }, 120_000);
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
  const safeRunId = options.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  try {
    await context.route("**/*", async route => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin) return route.abort("blockedbyclient");
      return route.continue({ headers: { ...route.request().headers(), ...(options.protectionBypass ? { "x-vercel-protection-bypass": options.protectionBypass } : {}) } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const versionResponse = await page.goto(new URL("/api/version", url).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const provenance = provenanceSchema.safeParse(await versionResponse?.json().catch(() => undefined));
    if (provenance.success) {
      evidence.provenance = provenance.data;
      evidence.identityPassed = Object.entries(options.expectedProvenance).every(([key, value]) => provenance.data[key as keyof Provenance] === value);
    }
    await page.goto(url.origin, { waitUntil: "networkidle", timeout: 30_000 });
    async function record(name: string, expected: string) {
      // Wait for React to commit after each user action; the assertion below records actual UI text.
      await page.waitForFunction(() => document.querySelector('[data-testid="temperature"]')?.textContent !== null);
      const actual = (await page.getByTestId("temperature").innerText()).trim();
      evidence.checks.push({ name, expected, actual, passed: actual === expected });
      return actual;
    }
    await record("default Celsius", "20°C");
    for (const [fixture, celsius, fahrenheit] of regressions) {
      await page.getByLabel("Forecast fixture").selectOption(fixture);
      await page.getByRole("button", { name: "Celsius", exact: true }).click();
      await record(`${fixture} Celsius`, `${celsius}°C`);
      await page.getByRole("button", { name: "Fahrenheit", exact: true }).click();
      const actual = await record(`${fixture} Fahrenheit`, `${fahrenheit}°F`);
      if (fixture === "pleasant") {
        evidence.seededDefectReproduced = actual === "20°F";
        await screenshot(page, `${safeRunId}-20c-toggle.png`);
      }
      for (let i = 0; i < 3; i++) {
        await page.getByRole("button", { name: "Celsius", exact: true }).click();
        await record(`${fixture} repeat ${i + 1} Celsius`, `${celsius}°C`);
        await page.getByRole("button", { name: "Fahrenheit", exact: true }).click();
        await record(`${fixture} repeat ${i + 1} Fahrenheit`, `${fahrenheit}°F`);
      }
    }
    await page.reload({ waitUntil: "networkidle" });
    await record("reload/default unit", "20°C");
    await screenshot(page, `${safeRunId}-reload.png`);
    evidence.status = evidence.identityPassed && evidence.checks.every(check => check.passed) ? "passed" : "failed";
    async function screenshot(page: Page, name: string) {
      const destination = path.join(options.outputDir, name);
      await page.screenshot({ path: destination, fullPage: true }); evidence.screenshots.push(destination);
    }
  } finally {
    clearTimeout(deadline); await context.close().catch(() => {}); await browser.close().catch(() => {});
    await writeFile(path.join(options.outputDir, `${safeRunId}-evidence.json`), JSON.stringify(evidence, null, 2));
  }
  return evidence;
}
