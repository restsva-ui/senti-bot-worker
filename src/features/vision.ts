// src/features/vision.ts
import { tgGetFilePath } from "../utils/telegram";

type EnvAll = {
  BOT_TOKEN: string;
  SENTI_CACHE?: KVNamespace;

  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;

  // альтернативні назви (для сумісності зі скрінами)
  CF_ACCOUNT_ID?: string;
  CF_VISION?: string;
};

async function getLastPhotoFileId(env: EnvAll, chatId: number) {
  if (!env.SENTI_CACHE) return null;
  // підтримуємо обидві ключові назви
  const v1 = await env.SENTI_CACHE.get(`lastPhoto:${chatId}`);
  if (v1) return v1;
  const v2 = await env.SENTI_CACHE.get(`last_photo:${chatId}`);
  return v2;
}

/** Обирає робочий endpoint моделі Gemini у Cloudflare AI */
async function pickGeminiEndpoint(
  accountId: string,
  headers: Record<string, string>
): Promise<string | null> {
  // перевіряємо кілька можливих назв маршруту — CF іноді змінює нотацію
  const candidates = [
    "@cf/google/gemini-1.5-flash",
    "gemini-1.5-flash",
    "@cf/google/gemini-1.5-pro",
    "gemini-1.5-pro",
  ];

  for (const model of candidates) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    try {
      // HEAD достатньо, щоб зловити 404 (немає маршруту). Інші коди — вважаємо валідними.
      const res = await fetch(url, { method: "HEAD", headers });
      if (res.status !== 404) return url;
    } catch {
      // ігноруємо мережеві помилки та пробуємо наступний
    }
  }
  return null;
}

export async function processPhotoWithGemini(
  env: EnvAll,
  chatId: number,
  prompt: string
): Promise<{ text: string }> {
  const fileId = await getLastPhotoFileId(env, chatId);
  if (!fileId) {
    return { text: "Спочатку надішли фото, а потім — коротку текстову підказку 😉" };
  }

  // 1) Отримуємо шлях до файлу з Telegram
  const filePath = await tgGetFilePath(env as any, fileId);
  if (!filePath) {
    return { text: "Не вдалось отримати шлях до фото з Telegram. Спробуй надіслати зображення ще раз." };
  }
  const tgFileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;

  // 2) Креденшали для Cloudflare AI
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN || env.CF_VISION;
  if (!accountId || !apiToken) {
    return { text: "AI ще не налаштований: додай CLOUDFLARE_ACCOUNT_ID та CLOUDFLARE_API_TOKEN (або CF_ACCOUNT_ID/CF_VISION)." };
  }

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "content-type": "application/json",
  };

  // 3) Обираємо робочий endpoint (уникаємо 'No route for that URI')
  const endpoint = await pickGeminiEndpoint(accountId, headers);
  if (!endpoint) {
    return { text: "AI помилка: модель Gemini недоступна у твоєму акаунті Cloudflare (No route for that URI)." };
  }

  // 4) Формуємо кілька варіантів тіла запиту (для сумісності з різними ревізіями CF AI)
  const bodies: any[] = [
    // A) сучасний мультимодальний формат messages + input_text/input_image
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: tgFileUrl },
          ],
        },
      ],
    },
    // B) альтернативне позначення content
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: tgFileUrl },
          ],
        },
      ],
    },
    // C) мінімалістичний формат (деякі білди CF AI теж приймають)
    { input_text: prompt, image: tgFileUrl },
  ];

  let lastError: string | null = null;

  // 5) Поки не отримаємо валідну відповідь — пробуємо варіанти тіл
  for (const body of bodies) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      // 401/403 — проблема з токеном/доступом
      if (res.status === 401 || res.status === 403) {
        return { text: "AI помилка: немає доступу до Cloudflare AI (перевір CLOUDFLARE_API_TOKEN)." };
      }

      const data = await res.json<any>().catch(() => ({}));

      // Стандарт CF: { success, result }
      if (data?.success === false) {
        lastError = data?.errors?.[0]?.message || `CF AI status ${res.status}`;
        continue;
      }

      const result = data?.result ?? data;

      // 6) Витягаємо текст максимально терпимо
      const text =
        result?.output_text ||
        result?.response ||
        result?.text ||
        (Array.isArray(result?.messages) &&
          result.messages.map((m: any) => m?.content?.text).filter(Boolean).join("\n")) ||
        (Array.isArray(result) && result[0]?.response) ||
        (typeof result === "string" ? result : null) ||
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