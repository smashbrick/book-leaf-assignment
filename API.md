# API reference

All endpoints are under `/api/v1` and return JSON. Every route except `/auth/login` and `/health` needs the login cookie (set by `/auth/login`).

Errors always look like:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{ "path": "subject", "message": "Subject must be at least 5 characters" }] } }
```
Status codes: `400` invalid input · `401` not logged in · `403` wrong role · `404` not found (or not yours) · `503` AI unavailable.

## Auth
| Endpoint | Description |
|---|---|
| `POST /auth/login` | Body `{ email, password }`. Sets the session cookie and returns `{ user: { id, role, name, authorId } }`. Wrong email or password → `401`. |
| `POST /auth/logout` | Clears the cookie. `204`. |
| `GET /auth/me` | The logged-in user. |

## Books
| Endpoint | Who | Description |
|---|---|---|
| `GET /books` | author, admin | Your books plus `royalty: { totalPending, threshold, meetsThreshold, nextPayoutBy, lastPayoutDate }`. Admins pass `?authorId=AUTH001`. |
| `GET /books/:bookId` | author, admin | One book. Another author's book → `404`. |

## Tickets
| Endpoint | Who | Description |
|---|---|---|
| `GET /tickets` | author, admin | Authors: their own tickets, each with `latestReply` (BookLeaf's most recent reply, or `null`). Admins: all tickets with AI fields and assignee, most urgent first. Filters: `status` (comma-separated, e.g. `open,in_progress`), `category`, `priority` (or `unclassified`; admins only, since priority is staff-only), `from` and `to` (`YYYY-MM-DD`, must be real dates). |
| `POST /tickets` | author | Body `{ bookId \| null, subject, description }`. `bookId: null` means General / Account. Returns `201` with the ticket. AI classification happens afterwards. |
| `GET /tickets/:id` | author (own), admin | The ticket with its `messages`. Admins also get internal notes, AI fields, and the author's `book` and `royalty` info. |
| `PATCH /tickets/:id` | admin | Any of `{ status, category, priority, assigneeId }`. `assigneeId` must be your own ID (assign to yourself) or `null`. |
| `POST /tickets/:id/messages` | author (own), admin | Body `{ body, internal }`. **Admins:** `internal: true` adds a staff-only note; otherwise it's a reply the author sees, and the first reply moves the ticket from Open to In Progress. **Authors:** adds a follow-up (`internal` is ignored). It reopens a Resolved ticket, clears the saved AI draft, and returns `400` on a Closed ticket. |
| `GET /tickets/:id/draft` | admin | The AI draft `{ body }`. Created the first time, then served from the database. `503 AI_UNAVAILABLE` if the AI can't be reached. |
| `POST /tickets/:id/draft` | admin | Generates a new draft (Regenerate). |
| `POST /tickets/:id/classify` | admin | Retries AI classification after a failure. |

Values: status `open | in_progress | resolved | closed` · priority `critical | high | medium | low` · category `royalty_payments | isbn_metadata | printing_quality | distribution_availability | book_status_production | general_inquiry`.

## Live updates and health
| Endpoint | Description |
|---|---|
| `GET /health` | Public. Returns `{ "status": "ok" }`. |
| `GET /events` | Server-Sent Events stream. Events are `ticket.created`, `ticket.updated` and `message.created`, each with data `{ "ticketId": 12 }`. Authors only receive events for their own tickets, and never for internal notes or AI changes. |

## Try it with curl
The cookie file keeps you logged in:
```bash
curl -c cookies.txt -X POST localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@bookleaf.com","password":"admin123"}'
curl -b cookies.txt "localhost:4000/api/v1/tickets?status=open,in_progress&priority=high"
```
