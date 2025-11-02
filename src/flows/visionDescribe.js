// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
// Правила:
//  • Якщо на фото НЕМає тексту — не згадуємо про це.
//  • Якщо розпізнано визначні місця — даємо точні лінки на Google Maps.
//  • Якщо ландмарків немає — звичайний короткий опис без лінків.
//  • Працюємо через JSON-режим + надійний фолбек у текстовий режим.
//
// Використання:
//   const { text } = await describeImage(env, { chatId, tgLang, imageBase64, question, modelOrder });

import { askVision } from "../lib/modelRouter.js";
import { buildVisionHintByLang, makeVisionUserPrompt, postprocessVisionText } from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";
import { detectLandmarks, formatLandmarkLines } from "../lib/landmarkDetect.js"; // ← NEW

// ─────────────────────────────────────────────────────────────────────────────
// Локальні утиліти

function stripProviderSignature(s = "") {
  return String(s)
    .replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "")
    .trim();
}
function normalizeText(s = "") {
  return stripProviderSignature(String(s || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
}
function mapsLink({ name, lat, lon, city, country }) {
  // Пріоритет: координати → інакше пошук за назвою + місто/країна.
  if (typeof lat === "number" && typeof lon === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  }
  const q = [name, city, country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
function langSafe(l) {
  const t = String(l || "").toLowerCase();
  return ["uk","ru","en","de","fr","pl","es","it"].includes(t) ? t : "uk";
}

// Формуємо інструкцію для JSON-відповіді (строгий формат)
function buildJsonSystemHint(lang) {
  return (
`Ти — візуальний аналітик Senti. Відповідай СТРОГО JSON українською/мовою користувача (${lang}).
Без пояснень поза JSON. Поля:

{
  "lang": "${lang}",
  "contains_text": true|false,
  "ocr_text": "<якщо contains_text=true, коротко без переносу рядків; інакше пусто>",
  "landmarks": [
    {
      "name": "<офіційна назва>", "type": "<monument|building|church|bridge|museum|natural|other>",
      "city": "<місто або пусто>", "country": "<країна або пусто>",
      "lat": <число або null>, "lon": <число або null>
    }
  ],
  "description": "<2–3 речення стислого людського опису фото без згадки, що ти ШІ>",
  "notes": ["<опц. корисні факти або попередження без water>"]
}

Правила:
- Якщо на фото немає тексту — "contains_text": false і "ocr_text": "" (НЕ пиши, що тексту немає).
- Якщо визначних місць немає — "landmarks": [].
- Не вигадуй. Уникай фраз на кшталт "як ШІ-модель...".
`
  );
}

// Створюємо промпт користувача для віжн-моделі у JSON-режимі
function buildJsonUserPrompt(basePrompt, lang) {
  return (
`${basePrompt}

Поверни СТРОГО JSON як вище. Без \`\`\`json\`\`\`, без коментарів.`
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Основна функція

/**
 * @param {object} env - середовище Cloudflare Worker (з KV, токенами тощо)
 * @param {object} p
 * @param {string|number} p.chatId          - id чату (для KV-переваг)
 * @param {string} [p.tgLang]               - msg.from.language_code з Telegram
 * @param {string} p.imageBase64            - зображення у base64 (без префікса data:)
 * @param {string} [p.question]             - питання користувача (caption або текст)
 * @param {string} [p.modelOrder]           - ланцюжок моделей для vision (напр., "gemini:gemini-2.5-flash,@cf/meta/llama-3.2-11b-vision-instruct")
 * @returns {Promise<{ text: string }>}     - нормалізований текст відповіді
 */
export async function describeImage(env, { chatId, tgLang, imageBase64, question, modelOrder }) {
  // 1) Мова користувача (оновлення за даними Телеграм)
  const lang0 = await getUserLang(env, chatId, tgLang);
  if (tgLang && tgLang.toLowerCase() !== lang0) {
    await setUserLang(env, chatId, tgLang);
  }
  const lang = langSafe(tgLang || lang0 || "uk");

  // 2) System hint + user prompt (базовий)
  const systemHintBase = buildVisionHintByLang(lang);
  const userPromptBase = makeVisionUserPrompt(question, lang);

  // 3) Спроба №1: JSON-режим (структурована відповідь)
  const jsonSystemHint = buildJsonSystemHint(lang);
  const jsonUserPrompt = buildJsonUserPrompt(userPromptBase, lang);

  let parsed = null;
  try {
    const raw = await askVision(env, modelOrder, jsonUserPrompt, {
      systemHint: jsonSystemHint,
      imageBase64,
      imageMime: "image/png",
      temperature: 0.1,
      max_tokens: 700,
      json: true,                 // ← просимо JSON; зайві поля ігноруються провайдером
    });

    // Модель може повернути текстовий JSON — спробуємо пропарсити.
    parsed = tryParseJsonLoose(String(raw || ""));
  } catch {
    parsed = null;
  }

  // 4) Якщо JSON коректний — форматування відповіді за правилами
  if (parsed && typeof parsed === "object") {
    const containsText = !!parsed.contains_text;
    const ocrText = containsText ? String(parsed.ocr_text || "").trim() : "";
    const landmarks = Array.isArray(parsed.landmarks) ? parsed.landmarks : [];
    const desc = normalizeText(String(parsed.description || "").trim());

    const lines = [];
    if (desc) lines.push(desc);

    // Якщо є текст — додамо його акуратно (без згадки "на фото немає тексту")
    if (containsText && ocrText) {
      lines.push(`Текст на фото: "${ocrText.replace(/\s+/g, " ").slice(0, 300)}"`);
    }

    // Ландмарки з моделі → лінки
    let totalAdded = 0;
    if (landmarks.length) {
      const unique = dedupLandmarks(landmarks);
      const links = unique.slice(0, 4).map((lm) => {
        const url = mapsLink(lm);
        const name = [lm.name, lm.city, lm.country].filter(Boolean).join(", ");
        return `• ${name} — ${url}`;
      });
      if (links.length) {
        lines.push(lang.startsWith("uk") ? "Посилання на мапу:" : "Map links:");
        lines.push(...links);
        totalAdded += links.length;
      }
    }

    // 🔁 Бекап-детектор: якщо модель не дала ландмарків — спробуємо самі
    if (totalAdded === 0) {
      const backup = await detectLandmarks(env, { description: desc, ocrText, lang });
      if (backup.length) {
        lines.push(...formatLandmarkLines(backup, lang));
      }
    }

    return { text: lines.join("\n") };
  }

  // 5) Фолбек: звичайний текстовий опис (без JSON), з твоїм постпроцесором
  const fallbackOut = await askVision(env, modelOrder, userPromptBase, {
    systemHint: systemHintBase,
    imageBase64,
    imageMime: "image/png",
    temperature: 0.2,
    max_tokens: 500,
  });

  // Спроба бекап-детектора і для фолбек-тексту
  const cleaned = postprocessVisionText(fallbackOut);
  const backup = await detectLandmarks(env, { description: cleaned, ocrText: "", lang });
  if (backup.length) {
    const lines = [cleaned, ...formatLandmarkLines(backup, lang)];
    return { text: lines.join("\n") };
  }

  return { text: cleaned };
}

// ─────────────────────────────────────────────────────────────────────────────
// Допоміжні парсери/дедуп

function tryParseJsonLoose(s) {
  // Прибираємо ```json ... ```
  let x = String(s || "").trim().replace(/```json/gi, "").replace(/```/g, "").trim();
  // Вирізаємо до першої { і останньої }
  const a = x.indexOf("{");
  const b = x.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) x = x.slice(a, b + 1);
  // Мінімізуємо типові помилки: коми перед ] або }
  x = x.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(x); } catch { return null; }
}

function dedupLandmarks(list) {
  const seen = new Set();
  const out = [];
  for (const lm of list) {
    const key = [
      String(lm.name || "").toLowerCase(),
      String(lm.city || "").toLowerCase(),
      String(lm.country || "").toLowerCase()
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: lm?.name || "",
      type: lm?.type || "other",
      city: lm?.city || "",
      country: lm?.country || "",
      lat: (typeof lm?.lat === "number" ? lm.lat : null),
      lon: (typeof lm?.lon === "number" ? lm.lon : null),
    });
  }
  return out;
}