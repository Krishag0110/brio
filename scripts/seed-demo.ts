import { writeFile } from "node:fs/promises";
import { seedWorkspace } from "../src/control/workspace-seed";
import { dataFile, withLocalState } from "../src/server/persistence";
import { runtimeConfig } from "../src/server/config";

// Run with: FDE_DEMO_MODE=true bun --no-env-file scripts/seed-demo.ts
const config = runtimeConfig();
if (config.mode !== "demo") throw new Error("Set FDE_DEMO_MODE=true. This command only seeds local demo storage.");
const result = await withLocalState(config, async current => {
  const { state, added } = seedWorkspace(current);
  if (added) await writeFile(`${dataFile()}.before-workspace-seed-${Date.now()}.json`, JSON.stringify(current), { mode: 0o600, flag: "wx" });
  return { state, value: { added, cases: state.cases.length, reports: state.cases.reduce((n, c) => n + c.signals.length, 0), revision: state.version } };
});
console.log(JSON.stringify(result));
