import { Router } from "express";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";

// Mounted behind requireAuth + requireRole("admin") in app.ts.
export const adminRouter = Router();

// GET /admin/staff: admins a ticket can be assigned to
adminRouter.get("/staff", async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY name`);
  res.json({ data: rows });
});

/**
 * GET /admin/stats: queue health plus evidence for how well the AI is doing.
 * Override rate = share of AI-classified tickets where staff changed the category or priority.
 */
adminRouter.get("/stats", async (_req, res) => {
  const [queue, ai, usage] = await Promise.all([
    pool.query(`
      SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
             count(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
             count(*) FILTER (WHERE status IN ('open','in_progress') AND priority = 'critical')::int AS "activeCritical",
             count(*) FILTER (WHERE status IN ('open','in_progress') AND assignee_id IS NULL)::int AS unassigned,
             count(*) FILTER (WHERE ai_status = 'failed')::int AS "aiFailed"
      FROM tickets`),
    pool.query(`
      SELECT count(*) FILTER (WHERE ai_status = 'done')::int AS classified,
             count(*) FILTER (WHERE ai_status = 'done' AND category IS DISTINCT FROM ai_category)::int AS "categoryOverrides",
             count(*) FILTER (WHERE ai_status = 'done' AND priority IS DISTINCT FROM ai_priority)::int AS "priorityOverrides",
             (SELECT count(*) FROM ticket_messages WHERE kind = 'reply')::int AS replies,
             (SELECT count(*) FROM ticket_messages WHERE kind = 'reply' AND used_ai_draft)::int AS "repliesFromAiDraft"
      FROM tickets`),
    pool.query(`
      SELECT purpose, count(*)::int AS calls, count(*) FILTER (WHERE NOT success)::int AS failures,
             COALESCE(round(avg(input_tokens)), 0)::int AS "avgInputTokens",
             COALESCE(round(avg(output_tokens)), 0)::int AS "avgOutputTokens",
             COALESCE(sum(cached_tokens), 0)::int AS "cachedTokens",
             COALESCE(round(avg(latency_ms)), 0)::int AS "avgLatencyMs"
      FROM ai_calls WHERE created_at > now() - interval '30 days' GROUP BY purpose`),
  ]);
  res.json({
    data: {
      queue: queue.rows[0],
      ai: { enabled: config.aiEnabled, model: config.AI_MODEL, ...ai.rows[0], usageLast30Days: usage.rows },
    },
  });
});
