import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { royaltySummary } from "../../lib/royalty.js";
import { parseParams, parseQuery } from "../../lib/validate.js";
import { getBook, listBooksByAuthor } from "./books.repo.js";

export const booksRouter = Router();

const ListQuery = z.object({ authorId: z.string().max(20).optional() });

/**
 * Authors always get their own books (any authorId param is ignored).
 * Admins must say whose books they want with ?authorId=.
 */
booksRouter.get("/", async (req, res) => {
  const user = req.user!;
  const { authorId: requested } = parseQuery(ListQuery, req);
  const authorId = user.role === "author" ? user.authorId! : requested;
  if (!authorId) throw badRequest("authorId query parameter is required for admins");

  const books = await listBooksByAuthor(pool, authorId);
  res.json({ data: books, royalty: royaltySummary(books) });
});

booksRouter.get("/:bookId", async (req, res) => {
  const { bookId } = parseParams(z.object({ bookId: z.string().max(20) }), req);
  const book = await getBook(pool, bookId);
  // 404 (not 403) for other authors' books, so IDs can't be probed for existence.
  if (!book || (req.user!.role === "author" && book.authorId !== req.user!.authorId)) throw notFound("Book");
  res.json({ data: book });
});
