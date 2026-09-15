import { copyFile, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { assertWeatherBuildFiles, isWeatherBuildFile } from "./weather-target";
import reviewedRuntime from "./runtime/package.json";

/** Copy only approved build inputs; never traverse .git, dependency folders, or credential files. */
export async function copyWeatherBuildInputs(repositoryDirectory: string, candidateDirectory: string) {
  const root = await realpath(repositoryDirectory), files: string[] = [];
  const directories = new Set(["app", "lib", "protected"]);
  async function walk(relative = "") {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) { if (relative || directories.has(entry.name)) await walk(file); continue; }
      if (!isWeatherBuildFile(file)) continue;
      const stat = await lstat(path.join(root, file));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 500_000) throw new Error("weather_build_file_type_or_size_invalid");
      files.push(file);
      if (files.length > 60) throw new Error("weather_build_file_limit");
    }
  }
  await walk(); assertWeatherBuildFiles(files);
  const manifest: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const dependencies = typeof manifest === "object" && manifest !== null && "dependencies" in manifest ? manifest.dependencies : undefined;
  if (!dependencies || typeof dependencies !== "object" || !["next", "react", "react-dom"].every(name => name in dependencies)) throw new Error("reviewed_weather_dependencies_required");
  for (const [name, version] of Object.entries(dependencies)) {
    if (!(name in reviewedRuntime.dependencies) || reviewedRuntime.dependencies[name as keyof typeof reviewedRuntime.dependencies] !== version) throw new Error("weather_runtime_dependency_drift");
  }
  for (const file of files) {
    const destination = path.join(candidateDirectory, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file), destination);
  }
  return files;
}
