import { rm } from "node:fs/promises";
import path from "node:path";

export default async function setup() {
  // Only the explicitly isolated browser-test database is reset, never the application demo database.
  await rm(path.resolve(__dirname, "../../.data/browser-tests.json"), {
    force: true,
  });
}
