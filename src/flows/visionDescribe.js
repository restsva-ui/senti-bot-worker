// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
// • Якщо на фото НЕМає тексту — не згадуємо про це.
// • Якщо розпізнано визначні місця — даємо компактні іконки-лінки (↗︎) без описів.
// • JSON-режим з авто-ретраями по MIME (png → jpeg → webp) + надійний текстовий фолбек.
// • Пам’ять фото: останній опис/ландмарки кешуються в KV для контексту діалогу.

import { askVision, askText } from "../lib/modelRouter.js";
import { buildVisionHintByLang, makeVisionUserPrompt, postprocessVisionText } from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";
import { detectLandmarks, formatLandmarkLines } from "../lib/landmarkDetect.js";
import { savePhotoMemory } from "../lib/photoMemory.js";

// ─────────────────────────────────────────────────────────────────────────────
// Локальні утиліти

function stripProviderSignature(s = "") {
  return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim();
}
function normalizeText(s = "") {
  return stripProviderSignature(String(s || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
}
function sanitizeBase64(b64 = "") {
  return String(b64).replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
}
function langSafe(l) {
  const t = String(l || "").toLowerCase();
  return ["uk","ru","en","de","fr","pl","es","it"].includes(t) ? t : "uk";
}

// компактна HTML-іконка на мапу (Telegram: parse_mode=HTML)
function mapIcon({ name, lat, lon, city, country }) {
  const q = (typeof lat === "number" && typeof lon === "number")
    ? `${lat},${lon}`
    : [name, city, country].filter(Boolean).join(", ");
  const url = `https://maps.google.com/?q=${encodeURIComponent(q)}`;
  // Повертаємо лише іконку ↗︎ як посилання (без розкриття URL)
  return `<a href="${url}">↗︎</a>`;
}

// коли точно треба йти у текстовий фолбек (режим vision недоступний технічно)
function shouldTextFallback(err) {
  const m = String(err && (err.message || err)).toLowerCase();
  if (!m) return false;
  return (
    m.includes("no route for that uri") ||
    m.includes("only text mode supported") ||
    m.includes("unsupported mode") ||
    (m.includes("vision") && m.includes("unsupported")) ||
    (m.includes("image") && m.includes("not") && m.includes("supported"))
    // safety/blocked НЕ переводить у текст — нехай спробують інші провайдери/MIME
  );
}

// «водяні знаки» зі стоків — не цитуємо в OCR
function isStockWatermark(s = "") {
  const x = s.toLowerCase();
  return /dreamstime|shutterstock|adobe\s*stock|istock|depositphotos|getty\s*images|watermark/.test(x);
}

// строгий JSON-хінт
function buildJsonSystemHint(lang) {
  return (
`Ти — візуальний аналітик Senti. Відповідай СТРОГО JSON українською/мовою користувача (${lang}).
Без пояснень поза JSON. Поля:
{
  "lang": "${lang}",
  "contains_text": true|false,
  "ocr_text": "<якщо contains_text=true, коротко без переносу рядків; інакше пусто>",
  "landmarks": [
    {"name": "<офіційна назва>", "type": "<monument|building|church|bridge|museum|natural|other>",
     "city": "<місто або пусто>", "country": "<країна або пусто>",
     "lat": <число або null>, "lon": <число або null>}
  ],
  "description": "<2–3 речення стислого людського опису фото без згадки, що ти ШІ>",
  "notes": ["<опц. корисні факти або попередження без water>"]
}
Правила:
- Якщо на фото немає тексту — "contains_text": false і "ocr_text": "" (НЕ пиши, що тексту немає).
- Якщо визначних місць немає — "landmarks": [].
- Не вигадуй.`
  );
}
function buildJsonUserPrompt(basePrompt) {
  return `${basePrompt}\n\nПоверни СТРОГО JSON як вище. Без \`\`\`json\`\`\`, без коментарів.`;
}
function buildTextFallbackHint(lang) {
  if (lang.startsWith("en")) {
    return `You cannot access the image right now. Reply briefly (1–2 sentences) in ${lang} with a neutral note like "Image analysis is temporarily unavailable" and suggest to resend the photo. No technical details.`;
  }
  return `Наразі доступ до зображення недоступний. Відповідай стисло (1–2 речення) мовою користувача (${lang}) з нейтральним повідомленням, що аналіз фото тимчасово недоступний, і запропонуй надіслати знімок ще раз. Без технічних подробиць.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Внутрішні ретраї по MIME

async function tryVisionJSON(env, modelOrder, jsonUserPrompt, jsonSystemHint, imageBase64) {
  const base64 = sanitizeBase64(imageBase64);
  const mimes = ["image/png", "image/jpeg", "image/webp"];
  let lastErr = null;

  for (const mime of mimes) {
    try {
      const raw = await askVision(env, modelOrder, jsonUserPrompt, {
        systemHint: jsonSystemHint,
        imageBase64: base64,
        imageMime: mime,
        temperature: 0.1,
        max_tokens: 700,
        json: true,
      });
      return { raw: String(raw || ""), forceTextFallback: false };
    } catch (e) {
      lastErr = e;
      if (shouldTextFallback(e)) return { raw: null, forceTextFallback: true, error: e };
      // safety/blocked — нехай спробує інший провайдер/MIME
    }
  }
  return { raw: null, forceTextFallback: false, error: lastErr };
}

async function tryVisionPlain(env, modelOrder, userPromptBase, systemHintBase, imageBase64) {
  const base64 = sanitizeBase64(imageBase64);
  const mimes = ["image/png", "image/jpeg", "image/webp"];
  let lastErr = null;

  for (const mime of mimes) {
    try {
      const out = await askVision(env, modelOrder, userPromptBase, {
        systemHint: systemHintBase,
        imageBase64: base64,
        imageMime: mime,
        temperature: 0.2,
        max_tokens: 500,
      });
      return { text: String(out || ""), forceTextFallback: false };
    } catch (e) {
      lastErr = e;
      if (shouldTextFallback(e)) return { text: null, forceTextFallback: true, error: e };
    }
  }
  return { text: null, forceTextFallback: false, error: lastErr };
}

// ─────────────────────────────────────────────────────────────────────────────
// Основна

/**
 * @param {object} env
 * @param {object} p
 * @param {string|number} p.chatId
 * @param {string} [p.tgLang]
 * @param {string} p.imageBase64
 * @param {string} [p.question]
 * @param {string} [p.modelOrder]  // якщо не передано — беремо env.MODEL_ORDER_VISION
 */
export async function describeImage(env, { chatId, tgLang, imageBase64, question, modelOrder }) {
  // 1) мова
  const lang0 = await getUserLang(env, chatId, tgLang);
  if (tgLang && tgLang.toLowerCase() !== lang0) await setUserLang(env, chatId, tgLang);
  const lang = langSafe(tgLang || lang0 || "uk");

  // 2) промпти
  const systemHintBase = buildVisionHintByLang(lang);
  const userPromptBase = makeVisionUserPrompt(question, lang);

  // 3) порядок моделей: vision за замовчуванням
  const visionOrder = String(modelOrder || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "");

  // 4) JSON-спроба
  const jsonSystemHint = buildJsonSystemHint(lang);
  const jsonUserPrompt = buildJsonUserPrompt(userPromptBase);
  let parsed = null;
  let forceTextFallback = false;

  const j = await tryVisionJSON(env, visionOrder, jsonUserPrompt, jsonSystemHint, imageBase64);
  if (j.raw) parsed = tryParseJsonLoose(j.raw); else forceTextFallback = !!j.forceTextFallback;

  // 5) успіх JSON
  if (parsed && typeof parsed === "object") {
    const containsText = !!parsed.contains_text;
    const ocrTextRaw   = containsText ? String(parsed.ocr_text || "").trim() : "";
    const landmarks    = Array.isArray(parsed.landmarks) ? parsed.landmarks : [];
    const desc         = normalizeText(String(parsed.description || "").trim());

    const lines = [];
    if (desc) lines.push(desc);

    // OCR — без «водяних знаків»
    if (containsText && ocrTextRaw && !isStockWatermark(ocrTextRaw)) {
      const ocr = ocrTextRaw.replace(/\s+/g, " ").slice(0, 300);
      if (ocr) lines.push(`Текст на фото: "${ocr}"`);
    }

    // іконки-лінки ↗︎ (без опису посилання)
    const icons = [];
    if (landmarks.length) {
      const unique = dedupLandmarks(landmarks).slice(0, 4);
      for (const lm of unique) icons.push(mapIcon(lm));
      if (icons.length) lines.push((lang.startsWith("uk") ? "Посилання на мапу: " : "Map: ") + icons.join("  "));
    }

    // бекап-детектор
    if (!icons.length) {
      const backup = await detectLandmarks(env, { description: desc, ocrText: ocrTextRaw, lang });
      if (backup.length) {
        const compact = backup.slice(0, 4).map(lm => mapIcon(lm)).join("  ");
        if (compact) lines.push((lang.startsWith("uk") ? "Посилання на мапу: " : "Map: ") + compact);
      }
    }

    const text = lines.join("\n");

    // 🧠 Пам’ять фото
    await savePhotoMemory(env, chatId, {
      description: desc,
      ocrText: containsText && !isStockWatermark(ocrTextRaw) ? ocrTextRaw : "",
      landmarks: Array.isArray(landmarks) ? landmarks : [],
      ts: Date.now(),
    });

    return { text, parse_mode: "HTML" };
  }

  // 6) фолбек у plain-vision
  if (!forceTextFallback) {
    const f = await tryVisionPlain(env, visionOrder, userPromptBase, systemHintBase, imageBase64);
    if (f.text) {
      const cleaned = postprocessVisionText(f.text);
      const backup = await detectLandmarks(env, { description: cleaned, ocrText: "", lang });

      const lines = [cleaned];
      if (backup.length) {
        const compact = backup.slice(0, 4).map(lm => mapIcon(lm)).join("  ");
        if (compact) lines.push((lang.startsWith("uk") ? "Посилання на мапу: " : "Map: ") + compact);
      }

      const text = lines.join("\n");

      await savePhotoMemory(env, chatId, {
        description: cleaned,
        ocrText: "",
        landmarks: backup,
        ts: Date.now(),
      });

      return { text, parse_mode: "HTML" };
    }
    forceTextFallback = !!f.forceTextFallback;
  }

  // 7) аварійний текстовий фолбек
  const textHint = buildTextFallbackHint(lang);
  const textMsg  = lang.startsWith("en") ? "Please provide a short, polite notice." : "Дай коротке ввічливе повідомлення.";
  const safeText = await askText(env, env.MODEL_ORDER_TEXT || env.MODEL_ORDER || "gemini:gemini-2.5-flash", textMsg, {
    systemHint: textHint, temperature: 0.1, max_tokens: 80,
  });

  // теж кладемо у «пам’ять» маркер недоступності
  await savePhotoMemory(env, chatId, { description: normalizeText(safeText), ocrText: "", landmarks: [], ts: Date.now(), degraded: true });

  return { text: normalizeText(safeText), parse_mode: "HTML" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Допоміжні парсери/дедуп

function tryParseJsonLoose(s) {
  let x = String(s || "").trim().replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = x.indexOf("{"); const b = x.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) x = x.slice(a, b + 1);
  x = x.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(x); } catch { return null; }
}

function dedupLandmarks(list) {
  const seen = new Set(); const out = [];
  for (const lm of list) {
    const key = [String(lm?.name||"").toLowerCase(), String(lm?.city||"").toLowerCase(), String(lm?.country||"").toLowerCase()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: lm?.name || "", type: lm?.type || "other",
      city: lm?.city || "", country: lm?.country || "",
      lat: (typeof lm?.lat === "number" ? lm.lat : null),
      lon: (typeof lm?.lon === "number" ? lm.lon : null),
    });
  }
  return out;
}