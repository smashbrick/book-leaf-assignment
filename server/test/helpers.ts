import request from "supertest";
import type OpenAI from "openai";
import { createApp } from "../src/app.js";
import { setAiClient, type AiClient } from "../src/ai/client.js";
import { resetDatabase } from "../src/db/setup.js";

export const app = createApp();

/** Fresh schema and seed data for each test file. */
export const resetDb = resetDatabase;

/** Logs in and returns a supertest agent that carries the session cookie. */
export async function loginAs(email: string, password = email.endsWith("@bookleaf.com") ? "admin123" : "author123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

export const PRIYA = "priya.sharma@email.com"; // AUTH001: BK001, BK002
export const ROHIT = "rohit.kapoor@email.com"; // AUTH002: BK003, BK004
export const ADMIN = "admin@bookleaf.com";

/** A fake OpenAI-compatible client whose chat completion returns `content`, or throws `error`. */
export function fakeAi(handler: () => { content?: string; error?: unknown }) {
  const calls: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => {
          calls.push(params);
          const { content, error } = handler();
          if (error) throw error;
          return {
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          };
        },
      },
    },
  } as unknown as AiClient;
  setAiClient(client);
  return calls;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
