import type { Request } from "express";
import type { z } from "zod";

// Thin helpers so route handlers read as "parse input, call service, respond".
// A ZodError thrown here is turned into a 400 VALIDATION_ERROR by the error middleware.
export const parseBody = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {});
export const parseQuery = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.query);
export const parseParams = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.params);
