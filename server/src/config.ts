import { z } from "zod";

// All configuration comes from environment variables and is validated once at boot,
// so a missing secret fails loudly at startup instead of at the first request.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Set to "true" when the Postgres host requires TLS (most managed providers' public endpoints).
  DATABASE_SSL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  // The AI provider is anything that speaks the OpenAI-compatible Chat Completions API.
  // Default: a local model through Ollama (free, nothing leaves the machine, no key needed).
  // Gemini, Groq, Claude or OpenAI work by setting these three values (see .env.example).
  AI_BASE_URL: z.url().default("http://localhost:11434/v1"),
  AI_MODEL: z.string().default("llama3.2"),
  AI_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  // Generous because a local model on a laptop can take a while, especially on its first call.
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  // Hosted providers need a key; a local model (Ollama on localhost) doesn't.
  aiEnabled: Boolean(parsed.data.AI_API_KEY) || ["localhost", "127.0.0.1"].includes(new URL(parsed.data.AI_BASE_URL).hostname),
};
