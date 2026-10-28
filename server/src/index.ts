import { requeuePendingClassifications } from "./ai/jobs.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { setupIfEmpty } from "./db/setup.js";

// A fresh database gets the schema and BookLeaf's dataset automatically, so deploys need no manual step.
await setupIfEmpty();

createApp().listen(config.PORT, () => {
  console.log(`BookLeaf portal on http://localhost:${config.PORT} (AI ${config.aiEnabled ? config.AI_MODEL : "disabled"})`);
});

// Classify tickets still waiting for the AI (the seeded ones, or any interrupted by a restart).
requeuePendingClassifications().catch((err) => console.error("[ai] requeue failed", err));
