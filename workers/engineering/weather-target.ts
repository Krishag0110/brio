/** Build inputs are relative to the separately owned weather repository root. */
const rootFiles = new Set(["package.json", "bun.lock", "next.config.ts", "next.config.mjs", "tsconfig.json", "next-env.d.ts"]);
export const REQUIRED_WEATHER_FILES = ["package.json", "bun.lock", "lib/temperature.ts", "app/page.tsx", "protected/provenance.json", "protected/version.ts"] as const;
export function isWeatherBuildFile(relative: string): boolean {
  if (relative.startsWith("/") || relative.includes("\\") || relative.includes("\0") || relative.split("/").some(segment => !segment || segment === "." || segment === ".." || segment.startsWith("."))) return false;
  return rootFiles.has(relative) || /^(?:app|lib|protected)\/(?:[A-Za-z0-9_()[\]-]+\/)*[A-Za-z0-9_()[\]-]+\.(?:tsx?|css|json|svg|png|ico)$/.test(relative);
}
export function assertWeatherBuildFiles(files: readonly string[]): void {
  if (files.length > 60 || REQUIRED_WEATHER_FILES.some(required => !files.includes(required))) throw new Error("separate_weather_repository_required");
}
