// src/commands/echo.ts
import type { TgUpdate } from "../types";

export const echoCommand = {
  name: "echo",
  description: "Повторює текст після команди. Приклад: /echo Привіт",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    const text = msg?.text ?? "";

    if (!chatId) return;

    // Витягуємо все, що йде після /echo (з урахуванням /echo@botname)
    const m = text.match(/^\/echo(?:@\w+)?\s+([\s\S]+)/i);
    const payload = m?.[1]?.trim();

    const reply =
      payload && payload.length > 0
        ? payload
        : "Використання: <code>/echo ваш текст</code>";

    await sendMessage(env, chatId, reply, { parse_mode: "HTML" });
  },
} as const;

// --- локальний thin-wrapper, щоб не тягнути зайвого у роутері ---
async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}