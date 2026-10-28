import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAiClient } from "../src/ai/client.js";
import { pool } from "../src/db/pool.js";
import { ADMIN, app, loginAs, PRIYA, resetDb, ROHIT } from "./helpers.js";

// The most important guarantee in the API: authors only ever see their own data,
// and staff-only information never reaches an author.

beforeAll(async () => {
  setAiClient(null); // AI off: these tests are about access, not classification
  await resetDb();
});
afterAll(() => pool.end());

describe("authentication", () => {
  it("rejects requests without a session", async () => {
    const res = await request(app).get("/api/v1/tickets");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("uses the same error for a wrong password and an unknown email", async () => {
    const wrongPassword = await request(app).post("/api/v1/auth/login").send({ email: PRIYA, password: "nope" });
    const unknownEmail = await request(app).post("/api/v1/auth/login").send({ email: "nobody@x.com", password: "nope" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("returns field-level validation errors", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["email", "password"]);
  });
});

describe("authors are isolated from each other", () => {
  it("lists only the author's own books, ignoring an authorId override", async () => {
    const priya = await loginAs(PRIYA);
    const res = await priya.get("/api/v1/books?authorId=AUTH002");
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id).sort()).toEqual(["BK001", "BK002"]);
  });

  it("returns 404 (not 403) for another author's book or ticket", async () => {
    const priya = await loginAs(PRIYA);
    expect((await priya.get("/api/v1/books/BK003")).status).toBe(404);

    const rohit = await loginAs(ROHIT);
    const { body } = await rohit.get("/api/v1/tickets");
    const rohitsTicket = body.data[0].id;
    expect((await priya.get(`/api/v1/tickets/${rohitsTicket}`)).status).toBe(404);
  });

  it("won't let an author raise a ticket against someone else's book", async () => {
    const priya = await loginAs(PRIYA);
    const res = await priya.post("/api/v1/tickets").send({
      bookId: "BK003",
      subject: "Not my book",
      description: "Trying to file a ticket on another author's book.",
    });
    expect(res.status).toBe(400);
  });
});

describe("staff-only data stays staff-only", () => {
  it("blocks authors from admin-only actions", async () => {
    const priya = await loginAs(PRIYA);
    expect((await priya.patch("/api/v1/tickets/1").send({ status: "closed" })).status).toBe(403);
    expect((await priya.get("/api/v1/tickets/1/draft")).status).toBe(403);
  });

  it("hides internal notes, priority and AI fields from the author", async () => {
    const priya = await loginAs(PRIYA);
    const created = await priya.post("/api/v1/tickets").send({
      bookId: "BK001",
      subject: "Royalty question",
      description: "Why is my pending royalty ₹3,570 for Whispers of the Ganges?",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const admin = await loginAs(ADMIN);
    await admin.post(`/api/v1/tickets/${id}/messages`).send({ body: "Bank details missing, checking with finance", internal: true });
    await admin.post(`/api/v1/tickets/${id}/messages`).send({ body: "Hi Priya, looking into this now." });

    const authorView = (await priya.get(`/api/v1/tickets/${id}`)).body.data;
    expect(authorView.messages.map((m: { kind: string }) => m.kind)).toEqual(["author", "reply"]);
    expect(authorView).not.toHaveProperty("priority");
    expect(authorView).not.toHaveProperty("aiCategory");
    expect(authorView).not.toHaveProperty("assigneeId");

    // The author's ticket list shows the latest staff reply, never the internal note.
    const listed = (await priya.get("/api/v1/tickets")).body.data.find((t: { id: number }) => t.id === id);
    expect(listed.latestReply).toBe("Hi Priya, looking into this now.");

    const staffView = (await admin.get(`/api/v1/tickets/${id}`)).body.data;
    expect(staffView.messages.map((m: { kind: string }) => m.kind)).toEqual(["author", "internal_note", "reply"]);
  });
});

describe("ticket management", () => {
  it("moves a ticket to in_progress when an admin first replies", async () => {
    const priya = await loginAs(PRIYA);
    const id = (
      await priya.post("/api/v1/tickets").send({ bookId: null, subject: "Bio update", description: "How do I update my author bio please?" })
    ).body.data.id;

    const admin = await loginAs(ADMIN);
    const replied = await admin.post(`/api/v1/tickets/${id}/messages`).send({ body: "You can update it from your dashboard." });
    expect(replied.status).toBe(201);
    expect(replied.body.data.status).toBe("in_progress");
  });

  it("lets admins assign tickets to themselves, but not to someone else", async () => {
    const admin = await loginAs(ADMIN);
    const me = (await admin.get("/api/v1/auth/me")).body.user.id;
    expect((await admin.patch("/api/v1/tickets/1").send({ assigneeId: me })).body.data.assigneeName).toBe("Neha Gupta");
    expect((await admin.patch("/api/v1/tickets/1").send({ assigneeId: me + 1 })).status).toBe(400);
    expect((await admin.patch("/api/v1/tickets/1").send({ assigneeId: null })).body.data.assigneeId).toBeNull();
  });

  it("validates queue filters", async () => {
    const admin = await loginAs(ADMIN);
    expect((await admin.get("/api/v1/tickets?status=bogus")).status).toBe(400);
    const ok = await admin.get("/api/v1/tickets?status=open,in_progress&from=2020-01-01");
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBeGreaterThan(0);
  });

  it("doesn't let authors reply through the staff endpoint", async () => {
    const priya = await loginAs(PRIYA);
    expect((await priya.post("/api/v1/tickets/5/messages").send({ body: "hi" })).status).toBe(403);
  });
});
