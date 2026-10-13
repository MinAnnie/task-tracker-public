import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests need Postgres; run them with `pnpm test:integration`.
    exclude: ["src/**/*.integration.test.ts"],
  },
});
