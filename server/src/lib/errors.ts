import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/**
 * An error that maps directly to an HTTP response. Throw it anywhere in a request handler
 * (Express 5 forwards async errors automatically) and the error middleware formats it.
 *
 * Every error response has the same shape: { error: { code, message, details? } }
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, "BAD_REQUEST", message);
export const unauthorized = (message = "Authentication required") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have access to this resource") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  // Malformed JSON body from express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }
  // Anything else is a bug: log the details, but never leak internals to the client.
  console.error("[unhandled]", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side" } });
};
