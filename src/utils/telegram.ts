import type { Env } from "../types";

const TG_API = "https://api.telegram.org";

export async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `${TG_API}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // не кидаємо помилку в проді — просто лог
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("sendMessage failed:", res.status, t);
  }
}