import OpenAI from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runClassification } from "../src/ai/jobs.js";
import { setAiClient } from "../src/ai/client.js";
import { buildDraftContext } from "../src/ai/drafter.js";
import { KB, sectionsFor } from "../src/ai/knowledge-base.js";
import { pool } from "../src/db/pool.js";
import { ADMIN, fakeAi, loginAs, PRIYA, resetDb, sleep } from "./helpers.js";

// The AI must make support faster when it works and never block support when it doesn't.

beforeAll(resetDb);
afterAll(() => pool.end());
beforeEach(() => setAiClient(null));

/**
 * Creates a ticket through the API. Creation queues a background classification; with the AI client
 * set to null it fails fast, and we wait for that to settle so it can't race the test's fake AI.
 */
async function newTicket() {
  setAiClient(null);
  const priya = await loginAs(PRIYA);
  const res = await priya.post("/api/v1/tickets").send({
    bookId: "BK001",
    subject: "No royalty for 6 months",
    description: "I haven't received any royalty for six months and my emails go unanswered.",
  });
  expect(res.status).toBe(201);
  const id = res.body.data.id as number;
  while ((await ticketRow(id)).ai_status === "pending") await sleep(10);
  return id;
}

const ticketRow = async (id: number) => (await pool.query("SELECT * FROM tickets WHERE id = $1", [id])).rows[0];

describe("classification", () => {
  it("stores the AI's category and priority when the model answers correctly", async () => {
    const id = await newTicket();
    const calls = fakeAi(() => ({ content: JSON.stringify({ category: "royalty_payments", priority: "critical", reasoning: "Six months unpaid." }) }));
    await runClassification(id);

    const t = await ticketRow(id);
    expect(t).toMatchObject({ ai_status: "done", category: "royalty_payments", priority: "critical", ai_priority: "critical" });
    // Ticket text goes in the user message only, and the system prompt is static (so it can be cached).
    expect(calls[0]!.messages[0]!.content).not.toContain("six months");
    expect(calls[0]!.response_format).toMatchObject({ type: "json_schema" });
  });

  it("does not overwrite a category the admin already set", async () => {
    const id = await newTicket();
    fakeAi(() => ({ content: JSON.stringify({ category: "general_inquiry", priority: "low", reasoning: "x" }) }));
    const admin = await loginAs(ADMIN);
    await admin.patch(`/api/v1/tickets/${id}`).send({ category: "royalty_payments", priority: "high" });
    await runClassification(id);

    const t = await ticketRow(id);
    expect(t).toMatchObject({ category: "royalty_payments", priority: "high", ai_category: "general_inquiry", ai_priority: "low" });
  });

  it.each([
    ["the provider is rate limited", { error: new OpenAI.RateLimitError(429, undefined, "slow down", new Headers()) }, /rate limit/],
    ["the model returns invalid JSON", { content: "Sure! The category is royalties." }, /malformed JSON/],
    ["the model invents a category", { content: JSON.stringify({ category: "refunds", priority: "high", reasoning: "x" }) }, /expected categories/],
  ])("keeps the ticket usable when %s", async (_name, response, reason) => {
    const id = await newTicket(); // creating the ticket must succeed regardless of the AI
    fakeAi(() => response);
    await runClassification(id);

    const t = await ticketRow(id);
    expect(t.ai_status).toBe("failed");
    expect(t.ai_error).toMatch(reason);
    expect(t.category).toBeNull(); // shows as "Unclassified" in the queue, ranked just below critical
  });

  it("marks tickets failed with a clear reason when no API key is configured", async () => {
    const id = await newTicket();
    await runClassification(id);
    expect((await ticketRow(id)).ai_error).toMatch(/not configured/);
  });
});

describe("drafts", () => {
  it("returns 503 AI_UNAVAILABLE (so the UI falls back to manual) when AI is down", async () => {
    const id = await newTicket();
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/api/v1/tickets/${id}/draft`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    // ...and the admin can still reply by hand
    expect((await admin.post(`/api/v1/tickets/${id}/messages`).send({ body: "Manual reply" })).status).toBe(201);
  });

  it("caches the draft and only regenerates on request or when the author writes again", async () => {
    let n = 0;
    const id = await newTicket();
    const calls = fakeAi(() => ({ content: `Draft number ${++n}` }));
    const admin = await loginAs(ADMIN);

    expect((await admin.get(`/api/v1/tickets/${id}/draft`)).body.data.body).toBe("Draft number 1");
    expect((await admin.get(`/api/v1/tickets/${id}/draft`)).body.data).toMatchObject({ body: "Draft number 1", cached: true });
    expect(calls).toHaveLength(1);

    expect((await admin.post(`/api/v1/tickets/${id}/draft`)).body.data.body).toBe("Draft number 2");

    const priya = await loginAs(PRIYA);
    await priya.post(`/api/v1/tickets/${id}/messages`).send({ body: "Any update?" });
    expect((await admin.get(`/api/v1/tickets/${id}/draft`)).body.data.body).toBe("Draft number 3");
  });

  it("sends the book's real numbers and the computed payout date to the model", async () => {
    const id = await newTicket();
    const calls = fakeAi(() => ({ content: "ok" }));
    await pool.query("UPDATE tickets SET category = 'royalty_payments' WHERE id = $1", [id]);
    const admin = await loginAs(ADMIN);
    await admin.get(`/api/v1/tickets/${id}/draft`);

    const [system, user] = calls[0]!.messages.map((m) => String(m.content));
    expect(system).toContain("Royalty Policy");
    expect(system).not.toContain("Printing & Quality"); // only the relevant KB slice
    expect(user).toContain("Whispers of the Ganges");
    expect(user).toContain("₹3,570"); // BK001 pending royalty
    expect(user).toMatch(/Next scheduled payout date .*: \d{4}-\d{2}-\d{2}/);
    expect(user).not.toContain("priya.sharma@email.com"); // no contact details sent to the AI
  });
});

describe("prompt building", () => {
  it("sends only the relevant knowledge-base sections per category", () => {
    expect(sectionsFor("printing_quality")).toEqual([KB.printing]);
    expect(sectionsFor("royalty_payments")).not.toContain(KB.isbn);
    expect(sectionsFor("general_inquiry").length).toBeGreaterThan(3);
  });

  it("keeps only the last 6 messages and clips very long ones", () => {
    const thread = Array.from({ length: 10 }, (_, i) => ({ from: "author" as const, body: `message ${i} ${"x".repeat(i === 9 ? 5000 : 0)}` }));
    const ctx = buildDraftContext({
      ticketId: 1, category: "general_inquiry", subject: "s", authorFirstName: "A", agentFirstName: "B",
      book: null, royalty: null, thread, internalNotes: [], today: "2026-01-01",
    });
    expect(ctx).toContain("[4 earlier message(s) omitted]");
    expect(ctx).not.toContain("message 3 ");
    expect(ctx).toContain("message 4 ");
    expect(ctx).toContain("[…]");
  });
});
