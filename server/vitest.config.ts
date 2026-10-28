import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres database, so run files one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      // Separate database so tests never touch dev data. Override with TEST_DATABASE_URL.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://bookleaf:bookleaf@localhost:5433/bookleaf_test",
      JWT_SECRET: "test-secret-at-least-16-chars",
      AI_API_KEY: "", // tests inject a fake AI client; never call a real provider
    },
  },
});
