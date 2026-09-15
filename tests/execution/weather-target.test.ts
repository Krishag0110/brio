import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyWeatherBuildInputs } from "../../workers/engineering/copy-weather";
import { isWeatherBuildFile, REQUIRED_WEATHER_FILES } from "../../workers/engineering/weather-target";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "weather-repository-test-")); directories.push(root);
  const repository = path.join(root, "target"), candidate = path.join(root, "candidate");
  for (const file of [...REQUIRED_WEATHER_FILES, ".env.local", ".git/config", "node_modules/private/file.js", "README.md", "controller/package.json"]) {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await writeFile(path.join(repository, file), file === "package.json" ? JSON.stringify({ dependencies: { next: "16.3.5", react: "19.2.8", "react-dom": "19.2.8" } }) : `fixture content for ${file}`);
  }
  return { repository, candidate };
}
describe("separate weather repository build boundary", () => {
  it("copies root-relative build source while excluding git, credentials, dependencies and unrelated controller files", async () => {
    const { repository, candidate } = await fixture();
    const files = await copyWeatherBuildInputs(repository, candidate);
    expect(files.sort()).toEqual([...REQUIRED_WEATHER_FILES].sort());
    expect(await readFile(path.join(candidate, "lib/temperature.ts"), "utf8")).toContain("fixture content");
    for (const file of [".env.local", ".git/config", "node_modules/private/file.js", "controller/package.json", "weather-app/lib/temperature.ts"]) await expect(readFile(path.join(candidate, file))).rejects.toThrow();
  });
  it("rejects old nested targets and symlinked build source", async () => {
    const { repository, candidate } = await fixture();
    await rm(path.join(repository, "lib/temperature.ts"));
    await symlink(path.join(repository, ".env.local"), path.join(repository, "lib/temperature.ts"));
    await expect(copyWeatherBuildInputs(repository, candidate)).rejects.toThrow("weather_build_file_type_or_size_invalid");
    expect(isWeatherBuildFile("weather-app/lib/temperature.ts")).toBe(false);
  });
  it("requires a reviewed runtime update when the separate target dependency versions change", async () => {
    const { repository, candidate } = await fixture();
    await writeFile(path.join(repository, "package.json"), JSON.stringify({ dependencies: { next: "99.0.0", react: "19.2.8", "react-dom": "19.2.8" } }));
    await expect(copyWeatherBuildInputs(repository, candidate)).rejects.toThrow("weather_runtime_dependency_drift");
  });
  it("requires the committed Bun lock and excludes other package-manager locks", async () => {
    const { repository, candidate } = await fixture();
    await rm(path.join(repository, "bun.lock"));
    await expect(copyWeatherBuildInputs(repository, candidate)).rejects.toThrow("separate_weather_repository_required");
    expect(isWeatherBuildFile("package-lock.json")).toBe(false);
    expect(isWeatherBuildFile("yarn.lock")).toBe(false);
  });
  it.each(["../lib/temperature.ts", "lib/../protected/version.ts", "lib/.env", "/app/page.tsx", "app\\page.tsx", "app//page.tsx", "workers/engineering/protected-weather.ts"])("rejects non-target or unsafe path %s", file => expect(isWeatherBuildFile(file)).toBe(false));
});
