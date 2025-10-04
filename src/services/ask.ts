// src/services/ask.ts
// Smart /ask router: OpenRouter → Gemini → Cloudflare Workers AI (fallback) + photo-aware + memory

import type { Ai } from "@cloudflare/ai";
import type { Msg } from "./history";
import { processPhotoWithGemini } from "../features/vision";

/* ======================== Env & Types ======================== */
export interface AskEnv {
  AI: Ai;

  // text providers
  OPENROUTER_API_KEY?: string;
  OR_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;

  // for photo (vision via Cloudflare AI + Telegram file fetch in vision.ts)
  BOT_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;  // alt name
  CF_VISION?: string;      // alt name

  // KV where last photo-id is stored by the photo handler
  SENTI_CACHE?: KVNamespace;
}

export type AskResult = {
  text: string;
  provider: "openrouter" | "gemini" | "cloudflare-ai";
  model: string;
};

/* ======================== Helpers ======================== */
function getEnvKey(env: AskEnv, ...names: (keyof AskEnv)[]): string | undefined {
  for (const n of names) {
    const v = (env as any)?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function toGeminiContents(history: Msg[], prompt: string) {
  return [...history, { role: "user", content: prompt }].map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}

function looksLikePhotoPrompt(prompt: string): boolean {
  return /\b(photo|image|picture|фото|зображ|картин)\b/i.test(prompt);
}

async function hasRecentPhoto(env: AskEnv, chatId?: number): Promise<boolean> {
  if (!chatId || !env.SENTI_CACHE) return false;
  const k1 = await env.SENTI_CACHE.get(`lastPhoto:${chatId}`);
  if (k1) return true;
  const k2 = await env.SENTI_CACHE.get(`last_photo:${chatId}`);
  if (k2) return true;
  // ще одна рез. назва, якщо в інших гілках буде використана
  const k3 = await env.SENTI_CACHE.get(`photo:last:${chatId}`);
  return !!k3;
}

/* ======================== OpenRouter ======================== */
async function askOpenRouter(
  env: AskEnv,
  prompt: string,
  history: Msg[],
  signal: AbortSignal
): Promise<AskResult> {
  const key = getEnvKey(env, "OPENROUTER_API_KEY", "OR_API_KEY");
  if (!key) throw new Error("no-openrouter-key");

  const candidates = [
    "anthropic/claude-3.7-sonnet",
    "meta-llama/llama-3.1-405b-instruct",
    "deepseek/deepseek-chat",
  ];

  const messages = [...history, { role: "user", content: prompt }].map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let lastErr: any;
  for (const model of candidates) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: 512 }),
      });

      if (r.status >= 500 || r.status === 429) {
        lastErr = new Error(`openrouter:${model}:${r.status}`);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`openrouter:${model}:${r.status}`);
        continue;
      }

      const data: any = await r.json();
      const text = data?.choices?.[0]?.message?.content?.toString?.() ?? "";
      if (!text) throw new Error("openrouter-empty");
      return { text, provider: "openrouter", model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("openrouter-failed");
}

/* ======================== Gemini (text) ======================== */
async function askGemini(
  env: AskEnv,
  prompt: string,
  history: Msg[],
  signal: AbortSignal
): Promise<AskResult> {
  const key = getEnvKey(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
  if (!key) throw new Error("no-gemini-key");

  const models = [
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-1.5-flash",
  ];

  let lastErr: any;
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(
          key
        )}`,
        {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: toGeminiContents(history, prompt),
            generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
          }),
        }
      );

      if (r.status >= 500 || r.status === 429) {
        lastErr = new Error(`gemini:${model}:${r.status}`);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`gemini:${model}:${r.status}`);
        continue;
      }

      const data: any = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) throw new Error("gemini-empty");
      return { text, provider: "gemini", model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("gemini-failed");
}

/* ======================== Cloudflare Workers AI (text) ======================== */
async function askCloudflare(
  env: AskEnv,
  prompt: string,
  history: Msg[],
  signal: AbortSignal
): Promise<AskResult> {
  const models = ["@cf/meta/llama-3.1-70b-instruct", "@cf/meta/llama-3.1-8b-instruct"];
  const messages = [...history, { role: "user", content: prompt }];

  let lastErr: any;
  for (const model of models) {
    try {
      const r: any = await (env.AI as any).run(
        model,
        { messages, max_tokens: 512 },
        { signal } as any
      );
      const text = (r?.response ?? r?.result?.response ?? "").toString();
      if (!text) throw new Error("cf-empty");
      return { text, provider: "cloudflare-ai", model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("cloudflare-failed");
}

/* ======================== Public: smartAsk ======================== */
/**
 * Розумна відповідь:
 * 1) якщо є останнє фото (або prompt явно про фото) і переданий chatId — спершу пробуємо vision через Cloudflare AI (Gemini).
 * 2) для тексту: OpenRouter → Gemini → Cloudflare Workers AI.
 *
 * @param env   змінні середовища
 * @param prompt користувацький запит
 * @param history опціональна пам’ять (повідомлення у форматі Msg[])
 * @param chatId опціональний chatId (щоб “бачити” останнє фото в KV)
 */
export async function smartAsk(
  env: AskEnv,
  prompt: string,
  history: Msg[] = [],
  chatId?: number
): Promise<AskResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("ask-timeout"), 25_000);

  try {
    /* ---------- 0) Фото, якщо це доцільно ---------- */
    const photoCandidate =
      (chatId && (await hasRecentPhoto(env, chatId))) || looksLikePhotoPrompt(prompt);

    if (photoCandidate && chatId) {
      try {
        // Використовуємо існуючий пайплайн з features/vision.ts
        const vision = await processPhotoWithGemini(env as any, chatId, prompt);
        const text = (vision?.text || "").trim();

        // Якщо дійсно був опис фото — повертаємо як фінальну відповідь
        if (text && !/^Спочатку надішли фото/i.test(text)) {
          return {
            text,
            provider: "gemini",
            model: "cloudflare-ai:gemini-vision",
          };
        }
        // Якщо фото немає (повідомлення-підказка), падаємо в текстовий флоу нижче
      } catch {
        // Якщо vision зламався — ідемо далі в текстовий флоу
      }
    }

    /* ---------- 1) OpenRouter ---------- */
    if (getEnvKey(env, "OPENROUTER_API_KEY", "OR_API_KEY")) {
      try {
        return await askOpenRouter(env, prompt, history, controller.signal);
      } catch {
        // fallthrough
      }
    }

    /* ---------- 2) Gemini ---------- */
    if (getEnvKey(env, "GEMINI_API_KEY", "GOOGLE_API_KEY")) {
      try {
        return await askGemini(env, prompt, history, controller.signal);
      } catch {
        // fallthrough
      }
    }

    /* ---------- 3) Cloudflare Workers AI ---------- */
    return await askCloudflare(env, prompt, history, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}