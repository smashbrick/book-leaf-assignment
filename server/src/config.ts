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
  // Default is Google Gemini's free tier. Groq/OpenRouter/OpenAI work by changing these three values.
  // Optional on purpose: without a key the app runs in "AI unavailable" mode and degrades gracefully.
  AI_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  AI_BASE_URL: z.url().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  AI_MODEL: z.string().default("gemini-flash-lite-latest"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
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
  aiEnabled: Boolean(parsed.data.AI_API_KEY),
};
