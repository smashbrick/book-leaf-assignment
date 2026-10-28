# BookLeaf Author Support Portal

A support portal with two sides:
- **Authors** log in, see their books and royalties, raise support tickets, and watch for replies.
- **The BookLeaf team** works through a ticket queue. AI sorts each ticket into a category and priority, and drafts a reply from BookLeaf's knowledge base that the admin edits before sending.

**Live demo:** `<add deployed URL>`

## Test logins

| Role | Email | Password |
|---|---|---|
| Author | `priya.sharma@email.com` | `author123` |
| Author (has a book in production) | `sneha.kulkarni@email.com` | `author123` |
| Author (never been paid) | `ananya.reddy@email.com` | `author123` |
| Admin | `admin@bookleaf.com` | `admin123` |
| Admin | `support@bookleaf.com` | `admin123` |

All 10 authors from the sample data can log in with their email and `author123`. The login page has **Author** and **Admin** tabs, each with buttons that fill in these accounts. (`/login?as=admin` opens the Admin tab directly.)

The database also starts with 5 example tickets (based on the examples in the brief) so the admin queue isn't empty. They're classified by the AI when the server starts.

---

## Features

**Author portal**
- **My Books:** every book with ISBN, genre, publication date, status, MRP, copies sold and royalty earned / paid / pending. Books still in production show "Not yet" instead of zeros. A note at the top shows the next payout date, or that the balance is under the ₹1,000 minimum.
- **Get help:** choose a book (or "General / Account level"), add a subject and description. The attachment picker is UI only, as the brief allows.
- **My Tickets:** every ticket with its status and the team's replies. It updates live when an admin replies, with no refresh needed.

**Admin portal**
- **Ticket queue:** all tickets, filterable by status, category, priority and date. Sorted with the most urgent and oldest first.
- **AI classification:** each new ticket gets a category, a priority and a one-line reason. Admins can change either one.
- **AI draft reply:** opening a ticket shows a reply drafted from the knowledge base and the author's actual book data. The admin edits it, then sends.
- **Managing tickets:** change the status, add internal notes (authors never see them), and assign the ticket to yourself.

---

## Running it locally

You need Node 22.9+ and Docker (or your own Postgres).

```bash
npm install
cp .env.example .env        # set JWT_SECRET to any long random string, and AI_API_KEY (below)
docker compose up -d        # starts Postgres on port 5433
npm run db:reset            # creates the tables and loads the sample data
npm run dev                 # API on :4000, app on http://localhost:5173
```

**AI:** by default the app uses a **local model through [Ollama](https://ollama.com)**, which is free and needs no API key:
```bash
brew install ollama && ollama serve    # or install the Ollama desktop app
ollama pull llama3.2                   # ~2 GB, runs fine on a laptop
```
To use a hosted model instead (Gemini, Groq, Claude, OpenAI), set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` in `.env`. There's a table under [Model choice](#model-choice). The app also works with no AI at all: tickets stay "Unclassified" and admins write replies themselves.

Other commands: `npm test` (needs a `bookleaf_test` database: `docker compose exec db psql -U bookleaf -c "CREATE DATABASE bookleaf_test"`), `npm run build && npm start` (production build on one port), `npm run typecheck`.

| Env variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_SSL` | `true` for hosted Postgres (e.g. Neon) |
| `JWT_SECRET` | Signs login sessions |
| `AI_BASE_URL`, `AI_MODEL` | Default to local Ollama (`http://localhost:11434/v1`, `llama3.2`) |
| `AI_API_KEY` | Only needed for hosted providers. See [Model choice](#model-choice) |

---

## How it's built

**Stack:** React + Vite on the frontend, Express + TypeScript on the backend, Postgres for data. In production, Express serves the built React app as well, so it's a single deploy.

```
server/src
  index.ts, app.ts       startup and route setup
  config.ts              reads and checks env variables
  db/                    Postgres connection, schema.sql, sample data loader
  middleware/auth.ts     login sessions and role checks
  modules/auth           login / logout / me
  modules/books          an author's books
  modules/tickets        routes → service (the rules) → repo (the SQL)
  ai/                    knowledge base, classifier, reply drafter, background job
  realtime/              live updates (Server-Sent Events)
web/src
  pages/author, pages/admin, components, api (fetch + React Query hooks)
```

**Decisions and why:**
- **Express serves the React build.** One URL for the evaluators, and no CORS setup because the app and API share an origin.
- **Plain SQL with `pg` instead of an ORM.** The whole schema is in [`server/src/db/schema.sql`](server/src/db/schema.sql), and the queries are short.
- **Login uses a signed JWT in an httpOnly cookie.** JavaScript can't read it, and the browser sends it automatically.
- **Access rules live on the server.** Authors only ever get their own books and tickets. Asking for someone else's returns 404. Fields only staff should see (priority, AI fields, assignee, internal notes) are removed before the response is sent, not just hidden in the UI.
- **Live updates use Server-Sent Events.** Updates only go from server to browser, so SSE is simpler than WebSockets and reconnects on its own. An event only says "ticket 12 changed"; the browser then re-fetches it through the normal API.
- **Validation uses Zod.** Every request body and query string is checked, and errors come back per field.

**Database tables:** `users` (logins and roles), `authors`, `books`, `tickets`, `ticket_messages` (author message, staff reply or internal note) and `ai_drafts`. Tickets store both the **AI's** category/priority (`ai_category`, `ai_priority`) and the **current** one (`category`, `priority`). When an admin overrides, the AI's answer is kept, so you can see how often it was wrong.

---

## How the AI works

### Classification (when a ticket is created)
1. The ticket is saved and the author gets their confirmation straight away.
2. In the background, one AI call returns the **category, priority and a short reason** as JSON.
3. The JSON is checked against the allowed categories and priorities (Zod) before it's saved, so a made-up category is rejected.

The prompt ([`server/src/ai/classifier.ts`](server/src/ai/classifier.ts)) lists the six categories with what belongs in each, plus priority rules taken from the brief. For example, ISBN errors are high priority per BookLeaf policy, "no royalty for 6 months" is critical, and "update my bio" is low.

### Draft replies (when an admin opens a ticket)
The prompt ([`server/src/ai/drafter.ts`](server/src/ai/drafter.ts)) contains:
- BookLeaf's tone guidelines, word for word, plus rules: use only the facts given, never invent numbers or promises, and write `[CHECK: …]` when something needs a human to confirm it.
- **Only the knowledge-base section for the ticket's category**, along with the brief's matching example.
- **The author's real data:** the book's status, sales and royalties, plus the next payout date and whether the ₹1,000 minimum is met. These are calculated in code ([`server/src/lib/royalty.ts`](server/src/lib/royalty.ts)), because LLMs are unreliable at date maths.

Nothing goes to the author until the admin presses Send.

### When the AI is down
- Tickets are always created. The AI runs after the ticket is saved, never before.
- If classification fails (no key, rate limit, network error, bad JSON), the ticket shows as **Unclassified** with the reason. Unclassified tickets sort right after Critical so they don't get lost. Admins can set the category and priority themselves, or click "try again".
- If the draft fails, the API returns `503 AI_UNAVAILABLE` and the admin gets an empty box to write in.
- The OpenAI SDK retries rate limits and server errors twice. Tickets still waiting for classification are picked up again when the server restarts.

### Keeping cost down
- **Only the relevant part of the knowledge base is sent.** A royalty question sends about 150 tokens of policy instead of about 850 for the whole thing.
- **One call gives both category and priority.**
- **Drafts are saved.** Reopening a ticket doesn't call the AI again. A new draft is only made when the admin clicks Regenerate.
- **No full history.** The draft only gets the ticket, the latest reply, and internal notes.
- **Short outputs and caps** (`max_tokens` 400 for classification, 1200 for drafts). Token usage for every call is printed to the server log.

That works out to roughly 750 tokens in / 60 out per classification, and about 1,200 in / 350 out per draft.

### Model choice
I wanted this project to cost nothing to build and run, so during development I **ran a local model through Ollama** (`llama3.2`, a 3B model that runs fine on a laptop). It's free, needs no account, and no author data leaves the machine. Classifying a ticket into six categories and writing a short templated email are manageable for a small model, because the prompt gives it the policy and the facts it needs.

The code isn't tied to Ollama. It uses the OpenAI-compatible Chat Completions format, which most providers support, so **you can test it with any key by changing three env variables**:

| Provider | `AI_BASE_URL` | `AI_MODEL` | `AI_API_KEY` | Cost |
|---|---|---|---|---|
| Ollama (default) | `http://localhost:11434/v1` | `llama3.2` | not needed | Free, runs locally |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-flash-lite-latest` | from AI Studio | Free tier |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | from Groq console | Free tier |
| Anthropic Claude | `https://api.anthropic.com/v1/` | `claude-haiku-5-5` | from Anthropic console | Paid |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | from OpenAI | Paid |

The **live demo** uses Gemini's free tier, because free hosting can't run a local model.

To make every provider work, the prompt itself asks for JSON (not every provider supports `response_format`), every AI answer is checked with Zod, and I don't set `temperature`, since current Claude models reject values below 1 through this API. A small local model writes plainer drafts than a hosted one, so the quality you see depends on the model you plug in. If BookLeaf settled on Claude for production, I'd switch to Anthropic's native SDK to get prompt caching and native structured outputs. Anthropic describes its OpenAI-compatible layer as mainly for testing and comparing models.

**API key:** it's only read from environment variables on the server, and the browser never sees it. `.env` is in `.gitignore`.

---

## API

All endpoints are under `/api/v1` and return JSON. Every route except `/auth/login` and `/health` needs the login cookie.

Errors always look like:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{ "path": "subject", "message": "Subject must be at least 5 characters" }] } }
```
Status codes: `400` invalid input · `401` not logged in · `403` wrong role · `404` not found (or not yours) · `503` AI unavailable.

### Auth
| Endpoint | Description |
|---|---|
| `POST /auth/login` | Body `{ email, password }`. Sets the session cookie and returns `{ user: { id, role, name, authorId } }`. Wrong email or password → `401`. |
| `POST /auth/logout` | Clears the cookie. `204`. |
| `GET /auth/me` | The logged-in user. |

### Books
| Endpoint | Who | Description |
|---|---|---|
| `GET /books` | author | Your books plus `royalty: { totalPending, threshold, meetsThreshold, nextPayoutBy, lastPayoutDate }`. Admins pass `?authorId=AUTH001`. |
| `GET /books/:bookId` | author, admin | One book. Another author's book → `404`. |

### Tickets
| Endpoint | Who | Description |
|---|---|---|
| `GET /tickets` | author, admin | Authors: their own tickets. Admins: all tickets, most urgent first. Filters: `status` (comma-separated, e.g. `open,in_progress`), `category`, `priority` (or `unclassified`), `from` and `to` (`YYYY-MM-DD`). |
| `POST /tickets` | author | Body `{ bookId \| null, subject, description }`. `bookId: null` means General / Account. Returns `201` with the ticket. AI classification happens afterwards. |
| `GET /tickets/:id` | author (own), admin | The ticket with its `messages`. Admins also get internal notes, AI fields, and the author's `book` and `royalty` info. |
| `PATCH /tickets/:id` | admin | Any of `{ status, category, priority, assigneeId }`. `assigneeId` must be your own ID (assign to yourself) or `null`. |
| `POST /tickets/:id/messages` | admin | Body `{ body, internal }`. `internal: true` adds a staff-only note. Otherwise it's a reply the author sees, and the first reply moves the ticket from Open to In Progress. |
| `GET /tickets/:id/draft` | admin | The AI draft `{ body }`. Created the first time, then served from the database. `503 AI_UNAVAILABLE` if the AI can't be reached. |
| `POST /tickets/:id/draft` | admin | Generates a new draft (Regenerate). |
| `POST /tickets/:id/classify` | admin | Retries AI classification after a failure. |

Values: status `open | in_progress | resolved | closed` · priority `critical | high | medium | low` · category `royalty_payments | isbn_metadata | printing_quality | distribution_availability | book_status_production | general_inquiry`.

### Live updates
| Endpoint | Description |
|---|---|
| `GET /events` | Server-Sent Events stream. Events are `ticket.created`, `ticket.updated` and `message.created`, each with data `{ "ticketId": 12 }`. Authors only receive events for their own tickets, and never for internal notes or AI changes. |

---

## Tests

`npm test` runs 24 tests against a real test database:
- **Access:** you have to be logged in; authors can't see other authors' books or tickets, or raise tickets on them; authors can't use admin actions; authors never receive internal notes, priority or AI fields.
- **Tickets:** the first reply moves the ticket to In Progress; you can only assign tickets to yourself; filters are validated.
- **AI** (with a fake AI, so no real calls): classification is saved; an admin's choice is never overwritten; rate limits, broken JSON and invented categories are handled; drafts fall back to manual when the AI is down; drafts are reused; the prompt contains the right knowledge-base section and the book's real numbers, and no email address.
- **Royalty dates:** the next payout date and the ₹1,000 minimum.

## Deploying

`render.yaml` sets up a free Render web service. For the database I used a free Postgres from Neon. Set `DATABASE_URL`, `DATABASE_SSL=true` and `AI_API_KEY` (a Gemini free-tier key) in Render. Free hosting can't run Ollama, which is why the deployed version uses a hosted model. On first start, the app creates the tables and loads the sample data by itself.

## Limitations / what I'd do with more time
- Attachments are UI only. I'd add real uploads to cloud storage.
- Authors can't reply to a ticket. The brief only asked for them to see responses; a follow-up thread would be the next feature.
- The AI classification runs inside the web server process. That's fine at this size, but a bigger system would use a job queue.
- Live updates work for a single server. More than one server would need something like Redis to share events.
- I'd measure AI accuracy with a set of real past tickets before trusting the priorities fully. The AI's original answer is already stored next to any admin override, so that data builds up as the team uses it.
- Small local models write plainer drafts than hosted ones, and they're slower on a laptop (a draft can take 10–30 seconds). Gemini's free tier is fast but rate-limited, and Google can use free-tier data to improve its models. For real author data I'd use a paid provider with a data-processing agreement.
- I assumed calendar quarters (Jan–Mar, …) for royalty payouts, and that the ₹1,000 minimum is per author, not per book.
