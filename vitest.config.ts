import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/core/**/*.test.ts", "tests/execution/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/tests/browser/**"],
    testTimeout: 15000,
    fileParallelism: true,
  },
});
