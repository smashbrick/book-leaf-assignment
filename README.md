# BookLeaf Author Support Portal

**Authors** see their books and royalties and raise support tickets. **The BookLeaf team** works a ticket queue where AI sorts each ticket by category and priority and drafts a reply that the admin edits before sending.

Also see: [WRITEUP.md](WRITEUP.md) (approach and trade-offs) · [API.md](API.md) (every endpoint)

## Test logins

| Role | Email | Password |
|---|---|---|
| Author | `priya.sharma@email.com` | `author123` |
| Author (book in production) | `sneha.kulkarni@email.com` | `author123` |
| Author (never been paid) | `ananya.reddy@email.com` | `author123` |
| Admin | `admin@bookleaf.com` | `admin123` |
| Admin | `support@bookleaf.com` | `admin123` |

All 10 authors in the dataset log in with their email and `author123`. The login page has Author/Admin tabs with buttons that fill these in. Five example tickets are seeded so the queue isn't empty; the AI classifies them on startup.

## Running it locally

Needs Node 22.9+ and Docker (or your own Postgres).

```bash
npm install
cp .env.example .env        # works as-is for local use
docker compose up -d        # Postgres on port 5433
npm run db:reset            # create tables + load the sample data
npm run dev                 # app on http://localhost:5173 (API on :4000)
```

**AI:** the default is a free local model through [Ollama](https://ollama.com) (`brew install ollama && ollama serve`, then `ollama pull llama3.2`). To use a hosted model instead, set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` in `.env` (see [Model choice](#5-model-choice)). With no AI available, the app still works: tickets show as "Unclassified" and admins write replies themselves.

Other commands: `npm test` (needs a test DB: `docker compose exec db psql -U bookleaf -c "CREATE DATABASE bookleaf_test"`), `npm run build && npm start` (production build), `npm run typecheck`.

## Features

- **Authors:** *My Books* (all book and royalty fields, plus the next payout date); *Get help* (choose a book or "General / Account", subject, description, attachment picker); *My Tickets* (status, original query and the latest reply, updated live).
- **Admins:** a queue filterable by status, category, priority and date, sorted most urgent and oldest first; AI category and priority with a one-line reason, both editable; an AI draft reply to edit and send; status changes, internal notes and "assign to me".

## How it's built

React + Vite frontend, Express + TypeScript API, Postgres. In production Express also serves the React build, so it's one app on one URL.

- **Plain SQL (`pg`), no ORM.** The whole schema is one file: [`server/src/db/schema.sql`](server/src/db/schema.sql).
- **Tickets code is split into routes → service → repo:** HTTP and validation, then the rules, then SQL.
- **Login is a signed JWT in an httpOnly cookie,** so JavaScript can't read it.
- **Access rules are enforced on the server.** Authors only get their own data (anything else is a 404), and staff-only fields (priority, AI fields, assignee, internal notes) are removed before responses leave the server.
- **Live updates use Server-Sent Events.** An event only says "ticket 12 changed", and the browser re-fetches it through the normal API.
- **Zod validates every input,** and errors come back per field.
- **Tickets keep the AI's category and priority next to the current ones,** so admin overrides show how often the AI was wrong.

## How the AI works

One AI call classifies a new ticket in the background. When an admin opens a ticket, a second call drafts a reply. Nothing is sent to an author without an admin pressing Send.

### 1. Prompt engineering
- **Classification** ([`classifier.ts`](server/src/ai/classifier.ts)): the six categories with what belongs in each, and priority rules taken from the brief (ISBN error → high, "no royalty for 6 months" → critical, "update my bio" → low; judge impact, not tone). It returns `{ category, priority, reasoning }` as JSON, and the reasoning is shown to admins.
- **Drafts** ([`drafter.ts`](server/src/ai/drafter.ts)): BookLeaf's tone guidelines word for word; rules (only use the facts given, never invent amounts, dates or promises, write `[CHECK: …]` when unsure, end with a next step); **only the policy for this ticket's category**; and **the author's real data**: book status, sales, royalties, and the next payout date and ₹1,000 check, **calculated in code** ([`royalty.ts`](server/src/lib/royalty.ts)) because LLMs are bad at date maths.
- **Safety:** ticket text only goes in the user message and is treated as data, so "ignore your instructions" doesn't work. Only first names are sent.
- **Tested with a real model, then fixed:** "unpaid since July 2024" came out High instead of Critical (the model didn't know today's date; now it does). A never-paid author was told to wait (now long-overdue money is escalated within 48 hours, as the brief's example says). A draft invented a completion date (now only policy timelines are allowed). A prompt-injection test was correctly classified as Low.

### 2. API key security
The key is only read from env variables on the server, and all AI calls happen there; the browser never sees it. `.env` is git-ignored and no key ships with the code.

### 3. Error handling
- Tickets are saved **before** the AI runs, so creating one never fails because of the AI.
- If classification fails (no key, rate limit, network error, invalid JSON or category), the ticket shows as **Unclassified** with the reason, sorted right after Critical, with a "try again" link.
- If a draft fails, the API returns `503 AI_UNAVAILABLE` and the admin writes the reply manually.
- The SDK retries rate limits and server errors twice. Pending tickets are retried on restart. All of this is tested with a fake AI.

### 4. Cost awareness
**Do we send the whole ticket history and knowledge base on every call? No.**
- **Only the relevant policy:** a royalty ticket sends 149 tokens of policy instead of 680.
- **One call** for both category and priority.
- **Drafts are saved,** so reopening a ticket costs nothing.
- **No growing history:** the draft gets the ticket and the latest reply only.
- **Output caps,** fixed text first (cache-friendly), and token usage logged for every call.

Measured with Gemini Flash-Lite: classification 650–710 tokens in / 35–50 out; drafts 935–1,360 in / 165–325 out.

| | Tokens per ticket (in / out) | 5,000 tickets/month, small model\* | large model\* |
|---|---|---|---|
| This app (measured) | ~1,850 / ~275 | **~$1.60** | ~$65 |
| Naive\*\* (estimated) | ~9,300 / ~1,130 | ~$7.50 | ~$300 |

\*Reference prices: Claude Haiku 5.5 ($0.10 / $0.50 per million tokens) and Claude Opus 5.5 ($4 / $20). 5,000 tickets/month is my assumption.
\*\*Naive = separate calls for category and priority, the full knowledge base and whole conversation in every draft, and a new draft on each of ~3 opens.

### 5. Model choice
The model is a setting, not something baked in. For a project like this I'd rather use a **local LLM**: it's free, I learn more, and data stays on the machine. So the default is **Ollama with `llama3.2`**. I also tested with **Gemini's free tier**. For BookLeaf, use whatever provider you already have; it's three env variables:

| Provider | `AI_BASE_URL` | `AI_MODEL` | Key |
|---|---|---|---|
| Ollama (default) | `http://localhost:11434/v1` | `llama3.2` | not needed (free) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-flash-lite-latest` | free tier |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | free tier |
| Anthropic Claude | `https://api.anthropic.com/v1/` | `claude-haiku-5-5` | paid |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | paid |

If BookLeaf hasn't chosen a provider, I'd run ~100 real past tickets through two or three small models and pick the cheapest one whose categories, priorities and drafts are good enough. A small model is enough because the code does the hard parts (facts, dates, picking the policy). Tickets contain personal data, so where it's sent should be part of the choice too. To work with every provider, the prompt itself asks for JSON (validated with Zod) and no `temperature` is set, since Claude rejects low values through this API. On Claude long-term, I'd switch to Anthropic's native SDK for prompt caching.

## API

Every endpoint, with who can call it, inputs, outputs and errors: **[API.md](API.md)**.

## Tests

`npm test` runs 24 tests against a real test database, covering access control (authors can't see each other's data or staff-only fields), ticket rules, AI behaviour with a fake model (success, every failure case, saved drafts, what the prompt contains), and the royalty dates.

## Assumptions and notes

1. **Royalty quarters are calendar quarters**, so payouts are due by 15 May, 14 Aug, 14 Nov and 14 Feb.
2. **The ₹1,000 minimum applies to an author's total** across all their books, not per book.
3. **"Today" is the real date.** The dataset's payouts are from 2025, so some balances look long overdue and the AI escalates them.
4. **Authors can see replies but not reply back.** That's what the brief's "My Tickets" asks for.
5. **Admins assign tickets to themselves**, as the brief says.
6. **Attachments are UI only**, as the brief allows.
7. **Two demo admins were added** (the dataset has no staff). All authors use the password `author123`.
8. **Priorities** follow the brief's examples and the knowledge base. No response-time targets are defined.
9. **The knowledge base is used as written.** The "metadata updates take 3–5 business days" fact from the brief's example table is also added to the ISBN & Metadata section.
10. **No API key is included.** Use Ollama, add your own key, or run without AI.

Tested on macOS with Node 23 and Postgres 17. `npm run db:reset` restores the original data at any time.

## What I'd do with more time
- Real attachment uploads, author replies on tickets, email notifications.
- A job queue for AI calls, and Redis so live updates work across several servers.
- Measure AI accuracy on real past tickets (AI vs admin answers are already stored).
- A paid AI provider with a data-processing agreement for real author data.
