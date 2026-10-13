import { defineConfig } from "vitest/config";

/** Integration tests run against a real Postgres (see test/integration/global-setup.ts). */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    // Tests share one database and truncate it, so files must not run in parallel.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
