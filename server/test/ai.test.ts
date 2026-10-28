import OpenAI from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runClassification } from "../src/ai/jobs.js";
import { setAiClient } from "../src/ai/client.js";
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
  it("returns 503 AI_UNAVAILABLE (so the UI falls back to a manual reply) when AI is down", async () => {
    const id = await newTicket();
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/api/v1/tickets/${id}/draft`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    // ...and the admin can still reply by hand
    expect((await admin.post(`/api/v1/tickets/${id}/messages`).send({ body: "Manual reply" })).status).toBe(201);
  });

  it("saves the draft so reopening the ticket doesn't call the AI again", async () => {
    const id = await newTicket();
    let n = 0;
    const calls = fakeAi(() => ({ content: `Draft number ${++n}` }));
    const admin = await loginAs(ADMIN);

    expect((await admin.get(`/api/v1/tickets/${id}/draft`)).body.data.body).toBe("Draft number 1");
    expect((await admin.get(`/api/v1/tickets/${id}/draft`)).body.data.body).toBe("Draft number 1");
    expect(calls).toHaveLength(1);
    // "Regenerate" makes a new one
    expect((await admin.post(`/api/v1/tickets/${id}/draft`)).body.data.body).toBe("Draft number 2");
  });

  it("sends the relevant policy and the book's real numbers, but no contact details", async () => {
    const id = await newTicket();
    const calls = fakeAi(() => ({ content: "ok" }));
    await pool.query("UPDATE tickets SET category = 'royalty_payments' WHERE id = $1", [id]);
    const admin = await loginAs(ADMIN);
    await admin.get(`/api/v1/tickets/${id}/draft`);

    const [system, user] = calls[0]!.messages.map((m) => String(m.content));
    expect(system).toContain("Royalty Policy");
    expect(system).not.toContain("Printing & Quality"); // only the KB section for this category
    expect(user).toContain("Whispers of the Ganges");
    expect(user).toContain("₹3,570"); // BK001's pending royalty
    expect(user).toMatch(/Next scheduled payout date .*: \d{4}-\d{2}-\d{2}/);
    expect(user).not.toContain("priya.sharma@email.com");
  });
});

describe("knowledge base", () => {
  it("only sends the sections relevant to the ticket's category", () => {
    expect(sectionsFor("printing_quality")).toEqual([KB.printing]);
    expect(sectionsFor("royalty_payments")).not.toContain(KB.isbn);
    expect(sectionsFor("general_inquiry").length).toBeGreaterThan(3);
  });
});
