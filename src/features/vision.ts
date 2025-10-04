import { tgGetFilePath } from "../utils/telegram";

type EnvAll = {
  BOT_TOKEN: string;
  SENTI_CACHE?: KVNamespace;

  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;

  // альтернативні назви (для сумісності)
  CF_ACCOUNT_ID?: string;
  CF_VISION?: string;
};

async function getLastPhotoFileId(env: EnvAll, chatId: number) {
  if (!env.SENTI_CACHE) return null;
  // сумісність із двома ключами
  const v1 = await env.SENTI_CACHE.get(`lastPhoto:${chatId}`);
  if (v1) return v1;
  const v2 = await env.SENTI_CACHE.get(`last_photo:${chatId}`);
  return v2;
}

export async function processPhotoWithGemini(
  env: EnvAll,
  chatId: number,
  prompt: string
): Promise<{ text: string }> {
  const fileId = await getLastPhotoFileId(env, chatId);
  if (!fileId) return { text: "Спочатку надішли фото, а потім — коротку текстову підказку 😉" };

  // 1) Дістаємо шлях до файлу з Telegram
  const filePath = await tgGetFilePath(env as any, fileId);
  if (!filePath) {
    return { text: "Не вдалось отримати шлях до фото з Telegram. Спробуй надіслати зображення ще раз." };
  }
  const tgFileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;

  // 2) Готуємо креденшали для Cloudflare AI
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  const apiToken  = env.CLOUDFLARE_API_TOKEN || env.CF_VISION;
  if (!accountId || !apiToken) {
    return { text: "AI ще не налаштований: додай CLOUDFLARE_ACCOUNT_ID та CLOUDFLARE_API_TOKEN (або CF_ACCOUNT_ID/CF_VISION)." };
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/google/gemini-1.5-flash-001`;
  const headers = { Authorization: `Bearer ${apiToken}`, "content-type": "application/json" };

  // 3) Робимо запит до моделі. Є різні форми тіла — спробуємо кілька варіантів, щоб бути сумісними.
  const bodies: any[] = [
    // A) сучасний мультимодальний формат messages + input_text/input_image
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: tgFileUrl }
          ]
        }
      ]
    },
    // B) альтернативний messages формат
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: tgFileUrl }
          ]
        }
      ]
    },
    // C) мінімалістичний формат (деякі білди CF AI теж приймають)
    { input_text: prompt, image: tgFileUrl }
  ];

  let lastError: string | null = null;
  for (const body of bodies) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
      const data = await res.json<any>().catch(() => ({}));

      // Cloudflare API може повертати { success, result }, а може — одразу результат
      if (data?.success === false) {
        lastError = data?.errors?.[0]?.message || `CF AI status ${res.status}`;
        continue;
      }

      const result = data?.result ?? data;

      // максимально терпимий парсинг
      const text =
        result?.output_text ||
        result?.response ||
        result?.text ||
        (Array.isArray(result?.messages) && result.messages.map((m: any) => m?.content?.text).filter(Boolean).join("\n")) ||
        (Array.isArray(result) && result[0]?.response) ||
        JSON.stringify(result ?? data);

      if (text && String(text).trim()) {
        return { text: String(text).trim() };
      }

      lastError = `Порожня відповідь моделі (status ${res.status})`;
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
  }

  return { text: `AI помилка: ${lastError || "невідомо"}` };
}