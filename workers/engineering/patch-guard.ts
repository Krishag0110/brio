import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sha256 } from "../shared/security";

export const EDITABLE_PATHS = ["lib/temperature.ts"] as const;
export const patchSchema = z.object({ summary: z.string().min(1).max(2000), files: z.array(z.object({ path: z.string().min(1).max(200), beforeSha256: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().min(1).max(20_000) }).strict()).min(1).max(3) }).strict();
export type PatchProposal = z.infer<typeof patchSchema>;

export function assertAllowedPath(relative: string, approvedPaths: readonly string[] = EDITABLE_PATHS) {
  if (!relative || relative.includes("\\") || relative.includes("\0") || path.posix.isAbsolute(relative) || relative.split("/").some(segment => !segment || segment === "." || segment === "..") || path.posix.normalize(relative) !== relative || !EDITABLE_PATHS.includes(relative as typeof EDITABLE_PATHS[number]) || !approvedPaths.includes(relative)) throw new Error("patch_path_forbidden");
}
async function safeFile(root: string, relative: string): Promise<string> {
  assertAllowedPath(relative);
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error("patch_symlink_forbidden");
  }
  const canonical = await realpath(current);
  if (!canonical.startsWith(`${canonicalRoot}${path.sep}`) || !(await lstat(canonical)).isFile()) throw new Error("patch_escape_forbidden");
  return canonical;
}
export async function inspectAllowedFiles(root: string, approvedPaths: readonly string[]) {
  if (approvedPaths.length === 0 || approvedPaths.length > EDITABLE_PATHS.length) throw new Error("invalid_build_scope");
  const files = [];
  for (const relative of approvedPaths) {
    assertAllowedPath(relative, approvedPaths);
    const file = await safeFile(root, relative), content = await readFile(file, "utf8");
    if (Buffer.byteLength(content) > 20_000) throw new Error("source_too_large");
    files.push({ path: relative, content, beforeSha256: sha256(content) });
  }
  return files;
}
export async function applyVerifiedPatch(root: string, input: unknown, approvedPaths: readonly string[]): Promise<PatchProposal> {
  const proposal = patchSchema.parse(input);
  if (new Set(proposal.files.map(file => file.path)).size !== proposal.files.length) throw new Error("duplicate_patch_path");
  const writes: { target: string; content: string }[] = [];
  for (const file of proposal.files) {
    assertAllowedPath(file.path, approvedPaths);
    const target = await safeFile(root, file.path);
    if (sha256(await readFile(target)) !== file.beforeSha256) throw new Error("stale_patch_base");
    // Defense in depth for this one arithmetic-only source scope. The container is the isolation boundary.
    if (/\b(?:import|require|eval|Function|process|globalThis|fetch|XMLHttpRequest|WebSocket|document|window)\b/.test(file.content) || /(?:https?:|node:|<script)/i.test(file.content)) throw new Error("patch_capability_forbidden");
    writes.push({ target, content: file.content });
  }
  for (const write of writes) await writeFile(write.target, write.content, { mode: 0o644 });
  return proposal;
}
export function verifyChangedFiles(changes: { path: string; status: string; mode?: string }[], approvedPaths: readonly string[]) {
  if (!changes.length) throw new Error("empty_patch");
  for (const change of changes) {
    assertAllowedPath(change.path, approvedPaths);
    if (change.status !== "M" || (change.mode && change.mode !== "100644")) throw new Error("patch_file_type_forbidden");
  }
}
