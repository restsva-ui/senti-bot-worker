// src/services/smart-ask.ts
// Роутер провайдерів із фолбеком + (нове) підтримка історії.
// Провайдери: Cloudflare Workers AI → OpenRouter → Gemini

import type { Ai } from "@cloudflare/ai";
import type { ChatTurn } from "./history";
import { toChatMessages } from "./history";

export interface SmartAskEnv {
  AI?: Ai;                       // Workers AI binding
  OPENROUTER_API_KEY?: string;   // optional
  GEMINI_API_KEY?: string;       // optional
}

export interface SmartAskOptions {
  chatId?: number | string;
  systemPrompt?: string;
  history?: ChatTurn[];          // ← НОВЕ: історія
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** основна функція */
export async function smartAsk(env: SmartAskEnv, prompt: string, opt: SmartAskOptions = {}) {
  const started = Date.now();

  // 1) Workers AI (Cloudflare)
  try {
    if (env.AI) {
      const messages = toChatMessages(opt.history || [], opt.systemPrompt);
      messages.push({ role: "user", content: prompt });

      const res: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages,
        max_tokens: opt.maxTokens ?? 512,
        temperature: opt.temperature ?? 0.6,
        stream: false,
      });
      const text = res?.response || res?.output_text || "";
      if (text) return ok("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", text, started, res?.usage);
    }
  } catch (e: any) {
    // падаємо далі як фолбек
  }

  // 2) OpenRouter
  try {
    const key = env.OPENROUTER_API_KEY;
    if (key) {
      const messages = toChatMessages(opt.history || [], opt.systemPrompt);
      messages.push({ role: "user", content: prompt });

      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "anthropic/claude-3.7-sonnet",
          messages,
          max_tokens: opt.maxTokens ?? 512,
          temperature: opt.temperature ?? 0.6,
        }),
        signal: opt.signal,
      });
      const j: any = await safeJson(r);
      const t = j?.choices?.[0]?.message?.content || "";
      if (t) return ok("openrouter", "anthropic/claude-3.7-sonnet", t, started);
      throw new Error(j?.error?.message || `OpenRouter HTTP ${r.status}`);
    }
  } catch (e: any) {
    // фолбек нижче
  }

  // 3) Gemini
  try {
    const key = env.GEMINI_API_KEY;
    if (key) {
      const history = (opt.history || []).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const contents = [...history, { role: "user", parts: [{ text: prompt }] }];

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: {
              maxOutputTokens: opt.maxTokens ?? 512,
              temperature: opt.temperature ?? 0.6,
            },
          }),
          signal: opt.signal,
        }
      );
      const j: any = await safeJson(r);
      const t = j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "";
      if (t) return ok("gemini", "gemini-1.5-flash", t, started);
      throw new Error(j?.error?.message || `Gemini HTTP ${r.status}`);
    }
  } catch (e: any) {
    // закінчилися опції
  }

  return {
    provider: "none",
    model: "none",
    text: "⚠️ Жоден провайдер недоступний зараз.",
    ms: Date.now() - started,
  };
}

/* helpers */
function ok(provider: string, model: string, text: string, started: number, usage?: any) {
  return { provider, model, text, ms: Date.now() - started, usage };
}
async function safeJson(r: Response) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; }
}