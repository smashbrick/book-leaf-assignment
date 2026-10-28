import { requeuePendingClassifications } from "./ai/jobs.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { seed } from "./db/seed.js";

// Migrations run on every boot (they're idempotent), so a fresh deploy needs no manual step.
await migrate();
// Seed an empty database automatically, so the live demo always has BookLeaf's dataset loaded.
const { rows } = await pool.query("SELECT 1 FROM users LIMIT 1");
if (rows.length === 0) await seed();

const server = createApp().listen(config.PORT, () => {
  console.log(`BookLeaf portal listening on http://localhost:${config.PORT} (AI ${config.aiEnabled ? `on: ${config.AI_MODEL}` : "off"})`);
});

// Classify anything left pending (seeded tickets, or jobs lost in a restart). Not awaited: serve traffic meanwhile.
requeuePendingClassifications().catch((err) => console.error("[ai] requeue failed", err));

// Finish in-flight requests and close DB connections on deploy/restart.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref(); // SSE connections never close on their own
  });
}
