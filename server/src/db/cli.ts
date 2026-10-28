import { pool } from "./pool.js";
import { resetDatabase } from "./setup.js";

// `npm run db:reset`: wipe the database and load the schema + BookLeaf dataset again.
await resetDatabase();
await pool.end();
