import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Shared AI client. Uses the OpenAI-compatible Chat Completions API, which Ollama (local), Gemini, Groq,
 * Claude and OpenAI all support, so the provider is just config (AI_BASE_URL / AI_MODEL / AI_API_KEY).
 * The SDK already retries rate limits and 5xx errors with backoff (maxRetries).
 */

/** An AI failure with a short reason we can show to admins. */
export class AiError extends Error {}

export type AiClient = Pick<OpenAI, "chat">;

let client: AiClient | null = config.aiEnabled
  ? // Ollama ignores the key, but the SDK requires one, hence the placeholder.
    new OpenAI({ apiKey: config.AI_API_KEY ?? "ollama", baseURL: config.AI_BASE_URL, timeout: config.AI_TIMEOUT_MS, maxRetries: 2 })
  : null;

/** Lets tests swap in a fake client (or null to simulate "no API key"). */
export function setAiClient(fake: AiClient | null): void {
  client = fake;
}

function toAiError(err: unknown): AiError {
  if (err instanceof OpenAI.RateLimitError) return new AiError("AI rate limit or free-tier quota reached");
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return new AiError("AI API key is invalid");
  if (err instanceof OpenAI.NotFoundError) return new AiError(`AI model "${config.AI_MODEL}" not found`);
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiError("AI request timed out");
  if (err instanceof OpenAI.APIConnectionError) return new AiError(`Could not reach the AI service at ${config.AI_BASE_URL}`);
  if (err instanceof OpenAI.APIError) return new AiError(`AI service error (${err.status ?? "unknown"})`);
  return new AiError(`Unexpected AI error: ${(err as Error)?.message ?? String(err)}`);
}

export async function chat(
  purpose: string,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  if (!client) throw new AiError("AI is not configured (set AI_API_KEY, or run a local model with Ollama)");
  try {
    const response = await client.chat.completions.create(params);
    // Token usage in the logs, to keep an eye on cost.
    console.log(`[ai] ${purpose}: ${response.usage?.prompt_tokens ?? "?"} in / ${response.usage?.completion_tokens ?? "?"} out tokens`);
    return response;
  } catch (err) {
    throw toAiError(err);
  }
}
