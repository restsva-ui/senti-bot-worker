// src/telegram/api.ts
export async function sendMessage(token: string, chatId: number | string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  // <-- ключова діагностика
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[tg] sendMessage failed", res.status, body);
    throw new Error(`TG sendMessage ${res.status}: ${body}`);
  }

  return res.json();
}