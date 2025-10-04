// src/features/vision.ts
import { tgGetFilePath } from "../utils/telegram";

type EnvAll = {
  BOT_TOKEN: string;
  SENTI_CACHE?: KVNamespace;

  // Cloudflare AI
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;

  // альтернативні назви (для сумісності зі скрінами)
  CF_ACCOUNT_ID?: string;
  CF_VISION?: string;

  // OpenRouter Vision (fallback)
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL_VISION?: string;
  OPENROUTER_MODEL?: string;
  OR_MODEL?: string;
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

/** -------- OpenRouter Vision Fallback -------- */
const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function pickORVisModel(env: EnvAll): string {
  return (
    env.OPENROUTER_MODEL_VISION ||
    env.OPENROUTER_MODEL ||
    env.OR_MODEL ||
    "openrouter/auto"
  );
}

async function askOpenRouterVision(
  env: EnvAll,
  tgFileUrl: string,
  prompt: string
): Promise<string | null> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return null;

  const body = {
    model: pickORVisModel(env),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          // Більшість OR-моделей приймають 'input_image'. Деякі — 'image_url'.
          { type: "input_image", image_url: tgFileUrl },
        ],
      },
    ],
    temperature: 0.2,
  };

  const res = await fetch(OR_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://t.me/SentiBot",
      "X-Title": "Senti Vision",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text().catch(() => "");
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  if (!res.ok) {
    // Якщо OR недоступний або 4xx/5xx — повернемо null, нехай це трактують вище як фейл
    return null;
  }

  const text =
    data?.choices?.[0]?.message?.content ??
    (Array.isArray(data?.choices) ? data.choices.map((c: any) => c?.message?.content || "").join("\n") : "");

  const out = String(text || "").trim();
  return out || null;
}

/** -------- Основна функція Vision -------- */
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

  // 3) Спроба через Cloudflare AI (як основний шлях)
  if (accountId && apiToken) {
    const headers = { Authorization: `Bearer ${apiToken}`, "content-type": "application/json" };
    const endpoint = await pickGeminiEndpoint(accountId, headers);

    if (endpoint) {
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
            // токен є, але немає прав — не пробуємо інші тіла, одразу впадемо у OR fallback
            lastError = "немає доступу до Cloudflare AI";
            break;
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
            await cleanupPhoto(env, chatId);
            return { text: String(text).trim() };
          }

          lastError = `Порожня відповідь моделі (status ${res.status})`;
        } catch (e: any) {
          lastError = e?.message || String(e);
        }
      }

      // якщо CF не дав валідної відповіді — спробуємо OR нижче
    }
    // якщо endpoint не знайдено — спробуємо OR нижче
  }

  // 4) Fallback: OpenRouter Vision (якщо є ключ)
  const orText = await askOpenRouterVision(env, tgFileUrl, prompt);
  if (orText && orText.trim()) {
    await cleanupPhoto(env, chatId);
    return { text: orText.trim() };
  }

  // 5) повний фейл
  return { text: "AI помилка: жодна з моделей Vision не відповіла. Перевір ключі CF/OpenRouter та спробуй ще раз." };
}