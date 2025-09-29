// src/commands/ai.ts
import type { TgUpdate } from "../types";
import { AIManager } from "../ai/manager";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV?: KVNamespace;        // використаємо для стану "очікування"
  // опціональні ключі провайдерів (вмикаються автоматично, якщо є)
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
};

const AWAIT_KEY = (chatId: number | string) => `ai:await:${chatId}`;
const AWAIT_TTL = 60 * 5; // 5 хвилин
const PROMPT_TEXT = "✍️ Введіть свій запит до ШІ наступним повідомленням (можна просто текстом).";

function apiBase(env: Env) {
  return env.API_BASE_URL || "https://api.telegram.org";
}

async function tgCall(
  env: Env,
  method: string,
  payload: Record<string, unknown>
) {
  const res = await fetch(`${apiBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("tgCall error", method, res.status, t);
  }
  return res.json().catch(() => ({}));
}

async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  return tgCall(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function sendTyping(env: Env, chatId: number) {
  return tgCall(env, "sendChatAction", { chat_id: chatId, action: "typing" });
}

function getText(update: TgUpdate): string {
  const m = update.message ?? update.edited_message;
  return (m?.text ?? m?.caption ?? "").trim();
}

function getChatId(update: TgUpdate): number | undefined {
  const m = update.message ?? update.edited_message;
  return m?.chat?.id;
}

function formatAnswer(text: string, provider: string) {
  // обрізка на випадок дуже довгих відповідей
  const MAX = 1800;
  const body = text.length > MAX ? text.slice(0, MAX) + " …" : text;
  return `${body}\n\n— via <code>${provider}</code>`;
}

/**
 * /ai [запит] — виклик ШІ напряму.
 * Якщо запиту немає — увімкне режим "очікування тексту" і попросить ввести наступним повідомленням.
 */
export async function ai(update: TgUpdate, env: Env) {
  const chatId = getChatId(update);
  if (!chatId) return;

  const raw = getText(update);
  // підтримка /ai@BotName
  const m = raw.match(/^\/ai(?:@[\w_]+)?(?:\s+(.+))?$/i);
  const prompt = (m?.[1] ?? "").trim();

  if (!prompt) {
    // вмикаємо очікування наступного повідомлення
    if (env.LIKES_KV) {
      await env.LIKES_KV.put(AWAIT_KEY(chatId), "1", { expirationTtl: AWAIT_TTL });
    }
    await sendMessage(env, chatId, PROMPT_TEXT, {
      reply_to_message_id: (update.message ?? update.edited_message)?.message_id,
    });
    return;
  }

  await sendTyping(env, chatId);

  try {
    const manager = AIManager.fromEnv(env as any);
    const res = await manager.ask({
      prompt,
      temperature: 0.2,
      maxTokens: 700,
      timeoutMs: 18_000,
    });

    await sendMessage(env, chatId, formatAnswer(res.text, res.provider), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    await sendMessage(
      env,
      chatId,
      `❌ Не вдалося отримати відповідь від ШІ.\n<i>${msg}</i>`,
      { parse_mode: "HTML" }
    );
  }
}

/**
 * Обробник вільного тексту після /ai:
 * - якщо у KV активний стан очікування для цього чату;
 * - або якщо користувач відповів (reply) на системне повідомлення з підказкою.
 *
 * Повертає true, якщо повідомлення оброблено; інакше false.
 */
export async function aiMaybeHandleFreeText(update: TgUpdate, env: Env): Promise<boolean> {
  const msg = update.message;
  if (!msg || typeof msg.text !== "string") return false;

  // якщо це знов команда — не обробляємо тут
  if (msg.entities?.some((e) => e.type === "bot_command" && e.offset === 0)) {
    return false;
  }

  const chatId = msg.chat?.id;
  if (!chatId) return false;

  // 1) активний стан у KV?
  let awaiting = false;
  if (env.LIKES_KV) {
    awaiting = Boolean(await env.LIKES_KV.get(AWAIT_KEY(chatId)));
  }

  // 2) або це reply на нашу підказку?
  const isReplyToPrompt =
    !!msg.reply_to_message &&
    typeof msg.reply_to_message.text === "string" &&
    msg.reply_to_message.text.startsWith("✍️ Введіть свій запит до ШІ");

  if (!awaiting && !isReplyToPrompt) return false;

  // гасимо стан
  if (env.LIKES_KV) {
    await env.LIKES_KV.delete(AWAIT_KEY(chatId));
  }

  const prompt = msg.text.trim();
  if (!prompt) return true;

  await sendTyping(env, chatId);

  try {
    const manager = AIManager.fromEnv(env as any);
    const res = await manager.ask({
      prompt,
      temperature: 0.2,
      maxTokens: 700,
      timeoutMs: 18_000,
    });

    await sendMessage(env, chatId, formatAnswer(res.text, res.provider), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (e: any) {
    const msgErr = e?.message || String(e);
    await sendMessage(
      env,
      chatId,
      `❌ Не вдалося отримати відповідь від ШІ.\n<i>${msgErr}</i>`,
      { parse_mode: "HTML" }
    );
  }

  return true;
}

// Сумісність із реєстром
export const handleAi = ai;
export default ai;