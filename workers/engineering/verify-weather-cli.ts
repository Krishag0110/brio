import { readFile } from "node:fs/promises";
import { provenanceSchema, verifyWeather } from "./protected-weather";

async function main() {
  const [url, provenanceFile, outputDir, runId] = process.argv.slice(2);
  if (!url || !provenanceFile || !outputDir || !runId) throw new Error("usage: verify-weather-cli URL PROVENANCE_FILE OUTPUT_DIR RUN_ID");
  const expectedProvenance = provenanceSchema.parse(JSON.parse(await readFile(provenanceFile, "utf8")));
  const result = await verifyWeather({ url, expectedProvenance, outputDir, runId, allowedHosts: (process.env.WEATHER_ALLOWED_HOSTS ?? "").split(",").filter(Boolean), allowLocalhost: process.env.WEATHER_ALLOW_LOCALHOST === "true", protectionBypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status !== "passed") process.exitCode = 1;
}
main().catch(() => { process.stderr.write("protected_weather_verification_failed\n"); process.exitCode = 1; });
