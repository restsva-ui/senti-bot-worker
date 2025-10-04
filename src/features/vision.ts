// src/features/vision.ts
import { tgGetFilePath } from "../utils/telegram";

type EnvAll = {
  BOT_TOKEN: string;
  SENTI_CACHE?: KVNamespace;

  // Cloudflare AI (fallback)
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;  // сумісність
  CF_VISION?: string;      // сумісність

  // прямий Gemini (рекомендовано для надійності)
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
};

async function getLastPhotoFileId(env: EnvAll, chatId: number) {
  if (!env.SENTI_CACHE) return null;
  const v1 = await env.SENTI_CACHE.get(`lastPhoto:${chatId}`);
  if (v1) return v1;
  const v2 = await env.SENTI_CACHE.get(`last_photo:${chatId}`);
  return v2;
}

function pick(...vals: (string | undefined | null)[]) {
  for (const v of vals) {
    const s = (v || "").trim();
    if (s) return s;
  }
  return undefined;
}

/** з KV читаємо inline-дані, якщо є */
async function readInlineFromKV(env: EnvAll, chatId: number): Promise<{ mime: string; data: string } | null> {
  if (!env.SENTI_CACHE) return null;
  const raw = await env.SENTI_CACHE.get(`photo:last:${chatId}`);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j?.mime && j?.data) return { mime: String(j.mime), data: String(j.data) };
  } catch {}
  return null;
}

function guessMimeFromPath(filePath?: string | null): string {
  const p = (filePath || "").toLowerCase();
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

/** безпечне base64-кодування */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

/** Виклик Gemini через inline_data */
async function geminiInline(prompt: string, base64: string, mime: string, apiKey: string): Promise<string> {
  const models = ["models/gemini-2.0-flash", "models/gemini-1.5-flash", "models/gemini-1.5-flash-8b"];
  let lastErr: any;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt || "Опиши зображення, будь ласка." },
              { inline_data: { mime_type: mime, data: base64 } },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
      };

      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`gemini:${model}:${r.status}`);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`gemini:${model}:${r.status}`);
        continue;
      }
      const data: any = await r.json();
      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text)
          ?.filter(Boolean)
          ?.join("\n\n") ||
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";
      if (text) return String(text);
      lastErr = new Error("gemini-empty");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("gemini-failed");
}

/** CF: підбір працюючого ендпойнта для Gemini */
async function pickGeminiEndpointCF(accountId: string, headers: Record<string, string>): Promise<string | null> {
  const candidates = [
    "@cf/google/gemini-1.5-flash",
    "gemini-1.5-flash",
    "@cf/google/gemini-1.5-pro",
    "gemini-1.5-pro",
  ];
  for (const model of candidates) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    try {
      const res = await fetch(url, { method: "HEAD", headers });
      if (res.status !== 404) return url;
    } catch {}
  }
  return null;
}

export async function processPhotoWithGemini(
  env: EnvAll,
  chatId: number,
  prompt: string
): Promise<{ text: string }> {
  // 0) Перевірка фото
  const fileId = await getLastPhotoFileId(env, chatId);
  if (!fileId) {
    return { text: "Спочатку надішли фото, а потім — коротку підказку 😉" };
  }

  // 1) Перевага — inline з KV (надійно, не залежить від зовнішнього URL)
  let inline = await readInlineFromKV(env, chatId);

  // 2) Якщо inline відсутній — докачаємо самі через Telegram
  if (!inline) {
    const filePath = await tgGetFilePath(env as any, fileId);
    if (!filePath) {
      return { text: "Не вдалось отримати шлях до фото з Telegram. Спробуй надіслати зображення ще раз." };
    }
    const tgFileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
    try {
      const r = await fetch(tgFileUrl);
      if (r.ok) {
        const buf = await r.arrayBuffer();
        const base64 = arrayBufferToBase64(buf);
        const mime = guessMimeFromPath(filePath);
        inline = { mime, data: base64 };
        // покладемо на 10 хв для повторних запитів
        await env.SENTI_CACHE?.put(`photo:last:${chatId}`, JSON.stringify({ mime, data: base64, ts: Date.now(), filePath }), {
          expirationTtl: 600,
        });
      }
    } catch {
      // лишимо inline = null — далі підемо шляхом CF (image_url)
    }
  }

  // 3) Якщо є ключ Gemini — пробуємо через inline_data (найнадійніше)
  const geminiKey = pick(env.GEMINI_API_KEY, env.GOOGLE_API_KEY);
  if (geminiKey && inline) {
    try {
      const text = await geminiInline(prompt, inline.data, inline.mime, geminiKey);
      // продовжимо TTL, бо корисно повторити запит
      const raw = await env.SENTI_CACHE?.get(`photo:last:${chatId}`);
      if (raw) await env.SENTI_CACHE?.put(`photo:last:${chatId}`, raw, { expirationTtl: 600 });
      return { text };
    } catch (e: any) {
      // впадемо у CF як запасний варіант
    }
  }

  // 4) Fallback — Cloudflare AI через image_url
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN || env.CF_VISION;
  if (!accountId || !apiToken) {
    return { text: "AI ще не налаштований: додай CLOUDFLARE_ACCOUNT_ID та CLOUDFLARE_API_TOKEN (або CF_ACCOUNT_ID/CF_VISION)." };
  }

  // нам потрібен TG URL (навіть якщо inline є, CF як правило очікує url)
  const filePath2 = await tgGetFilePath(env as any, fileId);
  if (!filePath2) {
    return { text: "Не вдалось отримати шлях до фото з Telegram. Спробуй надіслати зображення ще раз." };
  }
  const tgFileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath2}`;

  const headers = { Authorization: `Bearer ${apiToken}`, "content-type": "application/json" };
  const endpoint = await pickGeminiEndpointCF(accountId, headers);
  if (!endpoint) {
    return { text: "AI помилка: модель Gemini недоступна у твоєму акаунті Cloudflare (No route for that URI)." };
  }

  const bodies: any[] = [
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
        return { text: String(text).trim() };
      }
      lastError = `Порожня відповідь моделі (status ${res.status})`;
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
  }

  return { text: `AI помилка: ${lastError || "невідомо"}` };
}