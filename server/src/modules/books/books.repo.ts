import type { Queryable } from "../../db/pool.js";

export interface Book {
  id: string;
  authorId: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

const BOOK_COLUMNS = `
  id, author_id AS "authorId", title, isbn, genre, publication_date AS "publicationDate", status, mrp,
  author_royalty_per_copy AS "authorRoyaltyPerCopy", total_copies_sold AS "totalCopiesSold",
  total_royalty_earned AS "totalRoyaltyEarned", royalty_paid AS "royaltyPaid",
  royalty_pending AS "royaltyPending", last_royalty_payout_date AS "lastRoyaltyPayoutDate",
  print_partner AS "printPartner", available_on AS "availableOn"`;

/** Published books first (newest first), then books still in production. */
export async function listBooksByAuthor(db: Queryable, authorId: string): Promise<Book[]> {
  const { rows } = await db.query<Book>(
    `SELECT ${BOOK_COLUMNS} FROM books WHERE author_id = $1
     ORDER BY publication_date DESC NULLS LAST, title`,
    [authorId],
  );
  return rows;
}

export async function getBook(db: Queryable, bookId: string): Promise<Book | null> {
  const { rows } = await db.query<Book>(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = $1`, [bookId]);
  return rows[0] ?? null;
}
