import { promises as fs } from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { initialState } from "../control/seed";
import type { ControlState, RuntimeConfig } from "../control/types";

export function dataFile(): string { return process.env.FDE_DEMO_DATA_PATH || path.join(process.cwd(), ".data", "demo-state.json"); }
export async function withLocalState<T>(config: RuntimeConfig, operation: (state: ControlState) => Promise<{ state: ControlState; value: T }> | { state: ControlState; value: T }): Promise<T> {
  if (config.mode !== "demo") throw new Error("local_storage_demo_only");
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Demo data is created at runtime; it is not a build asset to trace into deployment output.
  try { await fs.writeFile(/* turbopackIgnore: true */ file, JSON.stringify(initialState(config)), { flag: "wx", mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const release = await lockfile.lock(file, { retries: { retries: 25, minTimeout: 20, maxTimeout: 200 }, stale: 30000, update: 5000, realpath: false });
  try {
    const state = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8")) as ControlState;
    const result = await operation(state);
    const temporary = file + "." + process.pid + ".tmp";
    await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(result.state), { mode: 0o600 });
    await fs.rename(temporary, file);
    return result.value;
  } finally { await release(); }
}
