import { dropAll, migrate } from "./migrate.js";
import { pool } from "./pool.js";
import { seed } from "./seed.js";

// Usage: tsx src/db/cli.ts <migrate|seed|reset>
const command = process.argv[2];

try {
  if (command === "reset") await dropAll();
  if (command === "migrate" || command === "reset") await migrate();
  if (command === "seed" || command === "reset") {
    await migrate();
    await seed();
  }
  if (!["migrate", "seed", "reset"].includes(command ?? "")) {
    console.error("Usage: cli.ts <migrate|seed|reset>");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
