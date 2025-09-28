import type { Env } from "../index";

const TG_API = "https://api.telegram.org";

export async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `${TG_API}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("sendMessage fail:", r.status, t);
  }
}