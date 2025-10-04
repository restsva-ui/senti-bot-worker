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

// головне вікно "свіжості" фото для підпису (збільшено до 5 хв)
const FRESH_WINDOW_MS = 5 * 60 * 1000;

// новий уніфікований ключ
const KEY_NEW = (chatId: number) => `lastPhoto2:${chatId}`;

// legacy ключі (для читання й подальшого авто-міграції/очищення)
const LEGACY_KEYS = (chatId: number) => [
  `lastPhoto:${chatId}`,
  `last_photo:${chatId}`,
  `photo:last:${chatId}`,
  `photos:last:${chatId}`,
  `tg:lastPhoto:${chatId}`,
];

type PhotoRecord = { file_id: string; ts: number };

async function readPhotoRecord(env: EnvAll, chatId: number): Promise<PhotoRecord | null> {
  if (!env.SENTI_CACHE) return null;

  // 1) новий ключ
  const raw = await env.SENTI_CACHE.get(KEY_NEW(chatId));
  if (raw) {
    try {
      const obj = JSON.parse(raw) as PhotoRecord;
      if (obj?.file_id) return obj;
    } catch {}
  }

  // 2) legacy: зберемо найсвіжіший, якщо є кілька
  for (const k of LEGACY_KEYS(chatId)) {
    const v = await env.SENTI_CACHE.get(k);
    if (v) {
      // якщо натрапили на legacy — мігруємо у новий формат і видалимо старе
      const migrated: PhotoRecord = { file_id: v, ts: Date.now() };
      await env.SENTI_CACHE.put(KEY_NEW(chatId), JSON.stringify(migrated), { expirationTtl: 600 });
      // видаляємо старий
      try { await env.SENTI_CACHE.delete(k); } catch {}
      return migrated;
    }
  }

  return null;
}

async function cleanupPhoto(env: EnvAll, chatId: number) {
  if (!env.SENTI_CACHE) return;
  try { await env.SENTI_CACHE.delete(KEY_NEW(chatId)); } catch {}
  for (const k of LEGACY_KEYS(chatId)) {
    try { await env.SENTI_CACHE.delete(k); } catch {}
  }
}

/** Обирає робочий endpoint моделі Gemini у Cloudflare AI */
async function pickGeminiEndpoint(
  accountId: string,
  headers: Record<string, string>
): Promise<string | null> {
  const candidates = [
    "@cf/google/gemini-2.0-flash",
    "@cf/google/gemini-1.5-flash",
    "@cf/google/gemini-1.5-pro",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];

  for (const model of candidates) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    try {
      const res = await fetch(url, { method: "HEAD", headers });
      if (res.status !== 404) return url;
    } catch {
      // ігноруємо та пробуємо наступний
    }
  }
  return null;
}

export async function processPhotoWithGemini(
  env: EnvAll,
  chatId: number,
  prompt: string
): Promise<{ text: string }> {
  const rec = await readPhotoRecord(env, chatId);
  if (!rec?.file_id) {
    return { text: "Спочатку надішли фото, а потім — коротку текстову підказку 😉" };
  }

  // перевірка "свіжості"
  if (Date.now() - rec.ts > FRESH_WINDOW_MS) {
    await cleanupPhoto(env, chatId);
    return { text: "Фото вже застаріло (минуло більше 5 хв). Надішли, будь ласка, нове зображення." };
  }

  // 1) шлях до файлу з Telegram
  const filePath = await tgGetFilePath(env as any, rec.file_id);
  if (!filePath) {
    await cleanupPhoto(env, chatId);
    return { text: "Не вдалось отримати шлях до фото з Telegram. Спробуй надіслати зображення ще раз." };
  }
  const tgFileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;

  // 2) креденшали CF AI
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN || env.CF_VISION;
  if (!accountId || !apiToken) {
    return { text: "AI ще не налаштований: додай CLOUDFLARE_ACCOUNT_ID та CLOUDFLARE_API_TOKEN (або CF_ACCOUNT_ID/CF_VISION)." };
  }
  const headers = { Authorization: `Bearer ${apiToken}`, "content-type": "application/json" };

  // 3) робочий endpoint (уникаємо 'No route for that URI')
  const endpoint = await pickGeminiEndpoint(accountId, headers);
  if (!endpoint) {
    return { text: "AI помилка: модель Gemini недоступна у твоєму акаунті Cloudflare (No route for that URI)." };
  }

  // 4) кілька форматів тіла запиту (для різних ревізій CF AI)
  const bodies: any[] = [
    {
      messages: [{ role: "user", content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: tgFileUrl },
      ]}],
    },
    {
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: tgFileUrl },
      ]}],
    },
    { input_text: prompt, image: tgFileUrl },
  ];

  let lastError: string | null = null;

  for (const body of bodies) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });

      if (res.status === 401 || res.status === 403) {
        return { text: "AI помилка: немає доступу до Cloudflare AI (перевір CLOUDFLARE_API_TOKEN)." };
      }

      const data = await res.json<any>().catch(() => ({}));
      if (data?.success === false) {
        lastError = data?.errors?.[0]?.message || `CF AI status ${res.status}`;
        continue;
      }

      const result = data?.result ?? data;
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
        // успішно — очищаємо запис, щоб не тримати зайве
        await cleanupPhoto(env, chatId);
        return { text: String(text).trim() };
      }

      lastError = `Порожня відповідь моделі (status ${res.status})`;
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
  }

  return { text: `AI помилка: ${lastError || "невідомо"}` };
}