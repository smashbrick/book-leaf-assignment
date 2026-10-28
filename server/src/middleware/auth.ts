import type { RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export type Role = "author" | "admin";

/** What we know about the caller on every authenticated request. */
export interface AuthUser {
  id: number;
  role: Role;
  name: string;
  /** BookLeaf author ID (e.g. AUTH001). Only set for authors. */
  authorId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = "bl_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // one working day

/**
 * Sessions are a signed JWT in an httpOnly cookie: JavaScript can't read it (XSS can't steal it),
 * and since the API and SPA share an origin, SameSite=Lax blocks cross-site request forgery.
 */
export function setSessionCookie(res: Response, user: AuthUser): void {
  const token = jwt.sign(user, config.JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Rejects the request with 401 unless it carries a valid session cookie. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw unauthorized();
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, role: payload.role, name: payload.name, authorId: payload.authorId };
  } catch {
    throw unauthorized("Session expired or invalid. Please log in again.");
  }
  next();
};

/** Rejects with 403 unless the (already authenticated) user has one of the given roles. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
