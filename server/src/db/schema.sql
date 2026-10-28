-- BookLeaf support portal schema. Applied by `npm run db:reset`, or on first boot if the DB is empty.
-- Enums are Postgres ENUM types so the database itself rejects invalid values.

CREATE EXTENSION IF NOT EXISTS citext; -- case-insensitive emails

CREATE TYPE user_role       AS ENUM ('author', 'admin');
CREATE TYPE ticket_status   AS ENUM ('open', 'in_progress', 'resolved', 'closed');
CREATE TYPE ticket_category AS ENUM (
  'royalty_payments',
  'isbn_metadata',
  'printing_quality',
  'distribution_availability',
  'book_status_production',
  'general_inquiry'
);
CREATE TYPE ticket_priority AS ENUM ('critical', 'high', 'medium', 'low');
-- Lifecycle of the AI classification for a ticket. 'pending' = queued/running.
CREATE TYPE ai_status       AS ENUM ('pending', 'done', 'failed');
-- 'author' = message from the author; 'reply' = staff reply visible to the author;
-- 'internal_note' = staff-only note, never sent to the author.
CREATE TYPE message_kind    AS ENUM ('author', 'reply', 'internal_note');

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          user_role NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Author profile data from the BookLeaf dataset, 1:1 with a user of role 'author'.
CREATE TABLE authors (
  id          TEXT PRIMARY KEY,                -- e.g. 'AUTH001' (BookLeaf's own ID)
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT,
  city        TEXT,
  joined_date DATE
);

-- Money is stored in whole rupees (INTEGER) because the source data is whole rupees.
-- A production system would store paise (or use NUMERIC) to handle fractional amounts.
CREATE TABLE books (
  id                       TEXT PRIMARY KEY,     -- e.g. 'BK001'
  author_id                TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title                    TEXT NOT NULL,
  isbn                     TEXT,
  genre                    TEXT,
  publication_date         DATE,                 -- NULL while in production
  status                   TEXT NOT NULL,        -- free text from BookLeaf's production system
  mrp                      INTEGER,              -- NULL while in production
  author_royalty_per_copy  INTEGER,
  total_copies_sold        INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned     INTEGER NOT NULL DEFAULT 0,
  royalty_paid             INTEGER NOT NULL DEFAULT 0,
  royalty_pending          INTEGER NOT NULL DEFAULT 0,
  last_royalty_payout_date DATE,
  print_partner            TEXT,
  available_on             TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX books_author_id_idx ON books(author_id);

CREATE TABLE tickets (
  id             SERIAL PRIMARY KEY,
  author_id      TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  book_id        TEXT REFERENCES books(id) ON DELETE SET NULL, -- NULL = "General / Account level"
  subject        TEXT NOT NULL,
  description    TEXT NOT NULL,
  status         ticket_status NOT NULL DEFAULT 'open',

  -- Effective values used by the queue. Start as the AI's suggestion; an admin can override them.
  category       ticket_category,
  priority       ticket_priority,

  -- What the AI originally said. Never overwritten by admin overrides, so we can measure AI accuracy.
  ai_category    ticket_category,
  ai_priority    ticket_priority,
  ai_reasoning   TEXT,
  ai_status      ai_status NOT NULL DEFAULT 'pending',
  ai_error       TEXT,

  assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tickets_author_id_idx ON tickets(author_id);
CREATE INDEX tickets_queue_idx ON tickets(status, priority, created_at);

CREATE TABLE ticket_messages (
  id           SERIAL PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id    INTEGER NOT NULL REFERENCES users(id),
  kind         message_kind NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket_id_idx ON ticket_messages(ticket_id, created_at);

-- One saved AI draft per ticket, so reopening a ticket doesn't pay for a new AI call.
-- Replaced when the admin clicks "Regenerate", deleted once a reply is sent.
CREATE TABLE ai_drafts (
  ticket_id  INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
