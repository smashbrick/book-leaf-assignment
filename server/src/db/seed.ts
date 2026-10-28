import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { withTransaction } from "./pool.js";

// The dataset BookLeaf provided, used verbatim. Lives at the repo root next to the assignment.
const DATA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bookleaf_sample_data.json");

export const DEMO_AUTHOR_PASSWORD = "author123";
export const DEMO_ADMIN_PASSWORD = "admin123";

export const DEMO_ADMINS = [
  { email: "admin@bookleaf.com", name: "Neha Gupta" },
  { email: "support@bookleaf.com", name: "Karan Mehta" },
];

interface SeedBook {
  book_id: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string[];
}

interface SeedAuthor {
  author_id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  joined_date: string | null;
  books: SeedBook[];
}

// A few realistic tickets (modelled on the knowledge base examples) so the admin queue isn't empty
// on first login. They're inserted as ai_status='pending' and classified by the real AI pipeline on
// boot, so the demo shows genuine AI output, not hand-written labels.
const SAMPLE_TICKETS: { authorId: string; bookId: string | null; subject: string; description: string; hoursAgo: number }[] = [
  {
    authorId: "AUTH003",
    bookId: "BK005",
    subject: "No royalty received since publication",
    description:
      "My book Between Two Temples was published in July 2024 and I have still not received a single royalty payment. My dashboard shows ₹2,546 pending. What is going on? I have emailed twice already.",
    hoursAgo: 30,
  },
  {
    authorId: "AUTH002",
    bookId: "BK003",
    subject: "Different ISBN on Amazon vs printed copy",
    description:
      "The ISBN showing on the Amazon India listing for Code & Karma is different from the one printed on the back cover of my author copies. Readers are confused and I'm worried sales are going to the wrong listing.",
    hoursAgo: 5,
  },
  {
    authorId: "AUTH007",
    bookId: "BK013",
    subject: "When will cover design be finished?",
    description:
      "Midnight in Mysore has been in cover design for a while now. Can you tell me where things stand and when I can expect the book to move to typesetting?",
    hoursAgo: 50,
  },
  {
    authorId: "AUTH005",
    bookId: "BK008",
    subject: "Book showing 'Currently Unavailable' on Flipkart",
    description: "Cardamom & Chaos is showing as currently unavailable on Flipkart since last week. Amazon is fine. Can you check?",
    hoursAgo: 20,
  },
  {
    authorId: "AUTH001",
    bookId: null,
    subject: "Update my author bio",
    description: "Hi, I'd like to update the author bio that appears on my book pages. How do I do that?",
    hoursAgo: 72,
  },
];

export async function seed(): Promise<void> {
  const raw = JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as { authors: SeedAuthor[] };
  // Hash once and reuse: bcrypt is deliberately slow and every demo author shares a password.
  const authorHash = await bcrypt.hash(DEMO_AUTHOR_PASSWORD, 10);
  const adminHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 10);

  await withTransaction(async (db) => {
    for (const admin of DEMO_ADMINS) {
      await db.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [admin.email, adminHash, admin.name],
      );
    }

    for (const a of raw.authors) {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'author')
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [a.email, authorHash, a.name],
      );
      await db.query(
        `INSERT INTO authors (id, user_id, phone, city, joined_date) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [a.author_id, rows[0]!.id, a.phone, a.city, a.joined_date],
      );
      for (const b of a.books) {
        await db.query(
          `INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp,
             author_royalty_per_copy, total_copies_sold, total_royalty_earned, royalty_paid,
             royalty_pending, last_royalty_payout_date, print_partner, available_on)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (id) DO NOTHING`,
          [
            b.book_id, a.author_id, b.title, b.isbn, b.genre, b.publication_date, b.status, b.mrp,
            b.author_royalty_per_copy, b.total_copies_sold, b.total_royalty_earned, b.royalty_paid,
            b.royalty_pending, b.last_royalty_payout_date, b.print_partner, b.available_on,
          ],
        );
      }
    }

    // Only add sample tickets to an empty database, so re-running seed never duplicates them.
    const { rows: existing } = await db.query("SELECT 1 FROM tickets LIMIT 1");
    if (existing.length === 0) {
      for (const t of SAMPLE_TICKETS) {
        const created = new Date(Date.now() - t.hoursAgo * 3600_000);
        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO tickets (author_id, book_id, subject, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
          [t.authorId, t.bookId, t.subject, t.description, created],
        );
        await db.query(
          `INSERT INTO ticket_messages (ticket_id, sender_id, kind, body, created_at)
           SELECT $1, a.user_id, 'author', $2, $3 FROM authors a WHERE a.id = $4`,
          [rows[0]!.id, t.description, created, t.authorId],
        );
      }
    }
  });
  console.log(`[seed] ${raw.authors.length} authors, ${DEMO_ADMINS.length} admins, sample tickets ready`);
}
