import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Runs as the unprivileged candidate UID with no credentials, independently of browser QA.
async function main() {
  const source = pathToFileURL("/candidate/lib/temperature.ts").href;
  const { displayTemperature } = await import(source);
  for (const [celsius, expectedFahrenheit] of [[20, 68], [0, 32], [-40, -40], [100, 212]]) {
    assert.equal(displayTemperature(celsius, "C"), celsius);
    assert.equal(displayTemperature(celsius, "F"), expectedFahrenheit);
  }
}
main().catch(() => { process.stderr.write("focused_temperature_regression_failed\n"); process.exitCode = 1; });
