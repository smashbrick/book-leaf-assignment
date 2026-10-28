import OpenAI from "openai";
import { config } from "../config.js";
import { pool } from "../db/pool.js";

/**
 * All AI calls go through runAiCall(). The provider is anything that speaks the OpenAI-compatible
 * Chat Completions API (Gemini, Groq, OpenRouter, OpenAI...), so switching providers is a config change.
 *
 * runAiCall() adds three things on top of the SDK:
 *  1. A circuit breaker: after repeated failures we stop calling the API for a minute instead of
 *     making every ticket wait for a timeout during an outage.
 *  2. Error normalisation: SDK errors become an AiError with a short, admin-readable reason.
 *  3. Usage logging: token counts (including cached tokens) go to the ai_calls table, so cost is
 *     measured, not estimated.
 * The SDK itself already retries 429/5xx/connection errors with exponential backoff (maxRetries).
 */

export class AiError extends Error {
  constructor(
    message: string,
    /** Whether trying again later could succeed (rate limit, outage), as opposed to bad config. */
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type AiClient = Pick<OpenAI, "chat">;

let client: AiClient | null = config.aiEnabled
  ? new OpenAI({ apiKey: config.AI_API_KEY, baseURL: config.AI_BASE_URL, timeout: config.AI_TIMEOUT_MS, maxRetries: 2 })
  : null;

/** Test seam: swap in a fake client (or null to simulate "no API key"). */
export function setAiClient(fake: AiClient | null): void {
  client = fake;
  resetCircuit();
}

const FAILURE_THRESHOLD = 3;
const COOL_DOWN_MS = 60_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export function resetCircuit(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function describeError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof OpenAI.RateLimitError) return new AiError("AI rate limit or free-tier quota reached", true);
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError)
    return new AiError("AI API key is invalid or lacks permission", false);
  if (err instanceof OpenAI.NotFoundError) return new AiError(`AI model "${config.AI_MODEL}" not found at the provider`, false);
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiError("AI request timed out", true);
  if (err instanceof OpenAI.APIConnectionError) return new AiError("Could not reach the AI service", true);
  if (err instanceof OpenAI.BadRequestError) return new AiError(`AI rejected the request: ${err.message}`, false);
  if (err instanceof OpenAI.APIError) return new AiError(`AI service error (${err.status ?? "unknown"})`, true);
  return new AiError(`Unexpected AI error: ${(err as Error)?.message ?? String(err)}`, true);
}

export interface AiCallMeta {
  purpose: "classify" | "draft";
  ticketId: number | null;
}

/** Runs one chat completion with circuit breaking, error normalisation and usage logging. */
export async function runAiCall(
  meta: AiCallMeta,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  if (!client) throw new AiError("AI is not configured (no AI_API_KEY)", false);
  if (Date.now() < circuitOpenUntil) throw new AiError("AI temporarily paused after repeated failures", true);

  const started = Date.now();
  try {
    const response = await client.chat.completions.create(params);
    consecutiveFailures = 0;
    void logCall(meta, true, Date.now() - started, response.usage);
    return response;
  } catch (err) {
    const aiErr = describeError(err);
    if (aiErr.retryable && ++consecutiveFailures >= FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + COOL_DOWN_MS;
      console.warn(`[ai] circuit open for ${COOL_DOWN_MS / 1000}s after ${consecutiveFailures} failures`);
    }
    void logCall(meta, false, Date.now() - started, undefined, aiErr.message);
    throw aiErr;
  }
}

async function logCall(meta: AiCallMeta, success: boolean, latencyMs: number, usage?: OpenAI.CompletionUsage, error?: string) {
  try {
    await pool.query(
      `INSERT INTO ai_calls (ticket_id, purpose, model, success, input_tokens, output_tokens, cached_tokens, latency_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        meta.ticketId, meta.purpose, config.AI_MODEL, success,
        usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null,
        usage?.prompt_tokens_details?.cached_tokens ?? null, latencyMs, error ?? null,
      ],
    );
  } catch (err) {
    // Logging must never break the actual feature.
    console.error("[ai] failed to log usage", err);
  }
}
