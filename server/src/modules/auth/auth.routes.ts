import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../lib/errors.js";
import { parseBody } from "../../lib/validate.js";
import { type AuthUser, clearSessionCookie, requireAuth, setSessionCookie } from "../../middleware/auth.js";

export const authRouter = Router();

const LoginSchema = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Password is required").max(200),
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = parseBody(LoginSchema, req);
  const { rows } = await pool.query<{ id: number; name: string; role: AuthUser["role"]; password_hash: string; author_id: string | null }>(
    `SELECT u.id, u.name, u.role, u.password_hash, a.id AS author_id
     FROM users u LEFT JOIN authors a ON a.user_id = u.id WHERE u.email = $1`,
    [email],
  );
  const row = rows[0];
  // Same message whether the email or the password is wrong, so the endpoint can't be used to find accounts.
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }
  const user: AuthUser = { id: row.id, role: row.role, name: row.name, authorId: row.author_id };
  setSessionCookie(res, user);
  res.json({ user });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
