// src/commands/ai.ts
import type { Env, TgCtx, TgMessage } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Невеличкий роутер провайдерів: спочатку OpenRouter, далі — запасний plain текст.
async function askOpenRouter(env: Env, prompt: string) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = env.OPENROUTER_MODEL || "google/gemini-2.0-flash-lite-preview-02-05"; // будь-який дешевий за замовчуванням
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/", // рекомендовано OpenRouter
      "X-Title": "Senti Bot",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${txt}`);
  }

  const data = await r.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  return text ?? null;
}

function extractPrompt(msg: TgMessage) {
  const text = msg.text || msg.caption || "";
  // команди вигляду: `/ai щось` або reply на підказку — беремо все після /ai
  const cleaned = text.replace(/^\/ai(@\w+)?\s*/i, "").trim();
  return cleaned;
}

async function reply(ctx: TgCtx, chatId: number, text: string, replyTo?: number) {
  const url = `${ctx.env.API_BASE_URL || "https://api.telegram.org"}/bot${ctx.env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    reply_to_message_id: replyTo,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export default async function ai(ctx: TgCtx, msg: TgMessage) {
  try {
    const prompt = extractPrompt(msg);
    const chatId = msg.chat.id;
    const replyTo = msg.message_id;

    if (!prompt) {
      await reply(ctx, chatId, "🤖 *AI режим* (бета)\nНадішли: `/ai <запит>`", replyTo);
      return;
    }

    // статус про прийняття запиту (не обовʼязково)
    await reply(ctx, chatId, `✅ Прийняв запит: _${prompt}_\n(готую відповідь…)`, replyTo);

    // Перший пріоритет — OpenRouter
    let answer: string | null = null;
    try {
      answer = await askOpenRouter(ctx.env, prompt);
    } catch (e: any) {
      console.error("OpenRouter error:", e?.message || e);
    }

    if (!answer) {
      // запасний варіант — просте ехо, щоб не мовчати
      answer = "Поки що не зміг отримати відповідь від моделі. Спробуй ще раз або зміни запит 🙏";
    }

    await reply(ctx, chatId, answer);
  } catch (err: any) {
    console.error("ai handler error:", err?.stack || err?.message || err);
    const chatId = msg.chat.id;
    await reply(ctx, chatId, "❌ Сталася помилка під час обробки AI-запиту. Спробуй пізніше.");
  }
}