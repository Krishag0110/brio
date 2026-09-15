import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyVerifiedPatch, assertAllowedPath, EDITABLE_PATHS, verifyChangedFiles } from "../../workers/engineering/patch-guard";
import { sha256 } from "../../workers/shared/security";

const paths: string[] = [];
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), "fde-guard-test-")); paths.push(root); await mkdir(path.join(root, "lib"), { recursive: true }); const content = "export const number = 20;\n"; await writeFile(path.join(root, EDITABLE_PATHS[0]), content); return { root, content }; }
afterEach(async () => { await Promise.all(paths.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("allowlist patch boundary", () => {
  it.each(["../secret", "/etc/passwd", "lib/../protected/fixtures.ts", "lib//temperature.ts", "lib\\temperature.ts", "package.json", "protected/fixtures.ts", "app/api/version/route.ts", ".github/workflows/coding.yml", "tests/execution/patch-guard.test.ts", "lib/temperature.ts\0"])("rejects %s", value => expect(() => assertAllowedPath(value)).toThrow());
  it("accepts only a current approved source update", async () => {
    const { root, content } = await fixture();
    await applyVerifiedPatch(root, { summary: "Unit-test proposal fixture", files: [{ path: EDITABLE_PATHS[0], beforeSha256: sha256(content), content: "export const number = 68;\n" }] }, EDITABLE_PATHS);
    expect(await readFile(path.join(root, EDITABLE_PATHS[0]), "utf8")).toBe("export const number = 68;\n");
  });
  it("rejects stale source, protected scope, and capability escalation", async () => {
    const { root, content } = await fixture();
    await expect(applyVerifiedPatch(root, { summary: "Stale", files: [{ path: EDITABLE_PATHS[0], beforeSha256: sha256("stale"), content }] }, EDITABLE_PATHS)).rejects.toThrow("stale_patch_base");
    await expect(applyVerifiedPatch(root, { summary: "Escalation", files: [{ path: EDITABLE_PATHS[0], beforeSha256: sha256(content), content: "import fs from 'node:fs'" }] }, EDITABLE_PATHS)).rejects.toThrow("patch_capability_forbidden");
    expect(await readFile(path.join(root, EDITABLE_PATHS[0]), "utf8")).toBe(content);
  });
  it("rejects a symlink even when its path is allowlisted", async () => {
    const { root, content } = await fixture(), target = path.join(root, EDITABLE_PATHS[0]);
    await rm(target); await writeFile(path.join(root, "outside.ts"), content); await symlink(path.join(root, "outside.ts"), target);
    await expect(applyVerifiedPatch(root, { summary: "Escape", files: [{ path: EDITABLE_PATHS[0], beforeSha256: sha256(content), content }] }, EDITABLE_PATHS)).rejects.toThrow("patch_symlink_forbidden");
  });
  it("rejects rename, deletion, executable mode, and protected final diff", () => {
    for (const status of ["A", "D", "R", "T"]) expect(() => verifyChangedFiles([{ path: EDITABLE_PATHS[0], status }], EDITABLE_PATHS)).toThrow();
    expect(() => verifyChangedFiles([{ path: EDITABLE_PATHS[0], status: "M", mode: "120000" }], EDITABLE_PATHS)).toThrow();
    expect(() => verifyChangedFiles([{ path: "protected/fixtures.ts", status: "M" }], EDITABLE_PATHS)).toThrow();
    expect(() => verifyChangedFiles([{ path: EDITABLE_PATHS[0], status: "M", mode: "100644" }], EDITABLE_PATHS)).not.toThrow();
  });
});
