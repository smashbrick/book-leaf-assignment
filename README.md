# BookLeaf Author Support Portal

A support portal for BookLeaf. Authors view their books and royalties and raise tickets. Admins work a ticket queue where AI suggests each ticket's category and priority and drafts a reply for them to edit and send.

**Live demo:** https://bookleaf-support-portal-ze6i.onrender.com (logins below). It runs on free tiers, so the first load after a quiet spell takes about a minute while the server wakes up.

See also: [WRITEUP.md](WRITEUP.md) (approach and trade-offs) · [API.md](API.md) (endpoints)

## Setup

Requires Node 22.9+ and Docker.

```bash
npm install
cp .env.example .env
docker compose up -d     # Postgres on port 5433
npm run db:reset         # tables + sample data
npm run dev              # http://localhost:5173
```

**Logins:** `priya.sharma@email.com` / `author123` (author) and `admin@bookleaf.com` / `admin123` (admin). Every author in the dataset uses `author123`, and the login page lists test accounts you can click to fill in.

**AI:** defaults to a local Ollama model (`ollama pull llama3.2`), so no key is needed. To use Gemini, Claude or OpenAI, set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` in `.env` (examples in `.env.example`). Without AI, tickets simply stay "Unclassified".

**Tests:** `npm test` (first create the test DB: `docker compose exec db psql -U bookleaf -c "CREATE DATABASE bookleaf_test"`).

## Architecture

React + Vite frontend, Express + TypeScript API, Postgres. Express also serves the React build, so it runs as one app.

- Plain SQL (`pg`), no ORM. Schema: `server/src/db/schema.sql`.
- Tickets are split into routes (validation), a service (business rules) and a repo (SQL).
- Sessions are JWTs in httpOnly cookies. Authors only receive their own data, and staff-only fields are stripped on the server.
- Live updates use Server-Sent Events.
- The AI's category and priority are stored next to the admin's, so overrides can be measured.
- The live demo is one free Render web service (`render.yaml`) with Neon Postgres, both in Singapore. The server creates the tables and loads the sample data on first boot, and uses Gemini's free tier since free hosting can't run a local model.

## AI integration

**Prompts.** The classifier gets the six categories and priority rules drawn from the brief's examples, and returns JSON with a short reason. The drafter gets BookLeaf's tone guidelines, only the knowledge-base section for the ticket's category, and the author's real book and royalty data. Payout dates are computed in code, not by the model. It may not invent amounts, dates or promises, and marks unknowns as `[CHECK: ...]`. Testing on the sample tickets led to three fixes: adding today's date (long-unpaid royalties were rated High instead of Critical), banning made-up timelines, and confirming that prompt injection is ignored.

**API key.** Read from `.env` on the server only. The browser never sees it, and none is included.

**Failures.** Tickets are saved before the AI runs. If classification fails, the ticket shows as "Unclassified" near the top of the queue with a retry option. If drafting fails, the admin writes the reply. Rate limits are retried, and pending tickets are retried on restart.

**Cost.** No call sends the full history or knowledge base. Drafts get one category's policy, the latest reply and any author follow-up since then, category and priority come from a single call, and drafts are cached so reopening a ticket is free. Measured: ~1,850 tokens in and ~275 out per ticket, about $1.60 a month for 5,000 tickets on a small model, roughly 5x less than sending everything.

**Model choice.** The model is configuration, not code. I defaulted to a local LLM (Ollama) to keep the project free and to learn from running one, and tested with Gemini's free tier. For BookLeaf I'd use whichever OpenAI-compatible provider you already use, or compare two or three small models on real past tickets and pick the cheapest one that's good enough. A small model is enough because the code supplies the facts.

## Assumptions

- Royalty quarters are calendar quarters, and the ₹1,000 minimum applies to an author's total across books.
- "Today" is the real date, so the dataset's 2025 payouts can look overdue and get escalated.
- Authors can reply on their own tickets. Replying reopens a Resolved ticket; a Closed ticket needs a new one. Admins assign tickets to themselves. Attachments are UI only.
- Two demo admin accounts were added, since the dataset has none.

## Known limitations

- The free hosting sleeps when idle (first load ~1 minute), and Gemini's free tier has per-minute limits, so a burst of new tickets can briefly stay "Unclassified" until retried.
- Live updates and the AI job run inside one server process, so this runs as a single instance.
- The schema is applied with a reset script, not migrations, which is fine for seed data but not for real data.
- No login rate limiting, and a session can't be revoked before it expires (8 hours).

## With more time

Real attachments and email notifications. A job queue for AI calls and Redis for multi-server live updates. Database migrations and login rate limiting. Measuring AI accuracy on real past tickets.
