// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
// • Якщо на фото НЕМає тексту — не згадуємо про це.
// • Визначні місця: компактна іконка-лінк (↗︎) через HTML (<a href>), без довгих URL.
// • JSON-режим з авто-ретраями по MIME (png → jpeg → webp) + надійний текстовий фолбек.
// • Повертаємо метадані (meta) для автопам’яті фото: mapLinks, ocrText, landmarks.

import { askVision, askText } from "../lib/modelRouter.js";
import { buildVisionHintByLang, makeVisionUserPrompt, postprocessVisionText } from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";
import { detectLandmarks, formatLandmarkLines } from "../lib/landmarkDetect.js";

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
function escHtml(s="") {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function toMapsShort(u="") {
  return String(u)
    .replace("https://www.google.com/maps/search/?api=1&query=", "https://maps.google.com/?q=")
    .replace("https://maps.app.goo.gl/?q=", "https://maps.google.com/?q=")
    .replace("http://maps.app.goo.gl/?q=", "https://maps.google.com/?q=");
}

function mapsIconLink({ name, lat, lon, city, country }) {
  let href;
  if (typeof lat === "number" && typeof lon === "number") {
    href = `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lon}`)}`;
  } else {
    const q = [name, city, country].filter(Boolean).join(", ");
    href = `https://maps.google.com/?q=${encodeURIComponent(q)}`;
  }
  return `<a href="${href}" rel="noopener noreferrer">↗︎</a>`;
}

function shouldTextFallback(err) {
  const m = String(err && (err.message || err)).toLowerCase();
  if (!m) return false;
  return (
    m.includes("no route for that uri") ||
    m.includes("only text mode supported") ||
    m.includes("unsupported mode") ||
    (m.includes("vision") && m.includes("unsupported")) ||
    (m.includes("image") && m.includes("not") && m.includes("supported"))
  );
}

// водяні знаки зі стоків — не цитуємо в OCR
function isStockWatermark(s = "") {
  const x = s.toLowerCase();
  return /dreamstime|shutterstock|adobe\s*stock|istock|depositphotos|getty\s*images|watermark/.test(x);
}

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
// Внутрішні ретраї по MIME + альтернативний порядок моделей

async function tryVisionJSON(env, modelOrder, jsonUserPrompt, jsonSystemHint, imageBase64) {
  const base64 = sanitizeBase64(imageBase64);
  const mimes = ["image/png", "image/jpeg", "image/webp"];
  let lastErr = null;

  // 1) основний порядок
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
    }
  }

  // 2) CF-vision першим
  const cfFirst = "cf:@cf/meta/llama-3.2-11b-vision-instruct, gemini:gemini-2.5-flash";
  for (const mime of mimes) {
    try {
      const raw = await askVision(env, cfFirst, jsonUserPrompt, {
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
    }
  }

  // 3) м’який повтор (понижені ліміти)
  for (const mime of mimes) {
    try {
      const raw = await askVision(env, modelOrder, jsonUserPrompt, {
        systemHint: jsonSystemHint,
        imageBase64: base64,
        imageMime: mime,
        temperature: 0.0,
        max_tokens: 350,
        json: true,
      });
      return { raw: String(raw || ""), forceTextFallback: false };
    } catch (e) {
      lastErr = e;
      if (shouldTextFallback(e)) return { raw: null, forceTextFallback: true, error: e };
    }
  }

  return { raw: null, forceTextFallback: false, error: lastErr };
}

async function tryVisionPlain(env, modelOrder, userPromptBase, systemHintBase, imageBase64) {
  const base64 = sanitizeBase64(imageBase64);
  const mimes = ["image/png", "image/jpeg", "image/webp"];
  let lastErr = null;

  // 1) основний порядок
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

  // 2) CF-vision першим
  const cfFirst = "cf:@cf/meta/llama-3.2-11b-vision-instruct, gemini:gemini-2.5-flash";
  for (const mime of mimes) {
    try {
      const out = await askVision(env, cfFirst, userPromptBase, {
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

  // 3) м’який повтор із пониженими лімітами
  for (const mime of mimes) {
    try {
      const out = await askVision(env, modelOrder, userPromptBase, {
        systemHint: systemHintBase,
        imageBase64: base64,
        imageMime: mime,
        temperature: 0.0,
        max_tokens: 320,
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
 * @param {string} [p.modelOrder]
 * @returns {{ text: string, isHtml: boolean, meta?: { containsText: boolean, ocrText: string, landmarks: any[], mapLinks: string[] } }}
 */
export async function describeImage(env, { chatId, tgLang, imageBase64, question, modelOrder }) {
  // 0) базова валідація зображення
  const rawB64 = sanitizeBase64(imageBase64 || "");
  if (!rawB64 || rawB64.length < 32) {
    return {
      text: "Наразі не вдалося отримати зображення (порожні або пошкоджені дані). Надішли фото ще раз.",
      isHtml: false,
      meta: { containsText: false, ocrText: "", landmarks: [], mapLinks: [] }
    };
  }
  // обмеження ~10 МБ (13.3М символів base64)
  if (rawB64.length > 13_300_000) {
    return {
      text: "Файл завеликий для аналізу. Зменш розмір або надішли фото у стислому вигляді.",
      isHtml: false,
      meta: { containsText: false, ocrText: "", landmarks: [], mapLinks: [] }
    };
  }

  // 1) мова
  const lang0 = await getUserLang(env, chatId, tgLang);
  if (tgLang && tgLang.toLowerCase() !== lang0) await setUserLang(env, chatId, tgLang);
  const lang = langSafe(tgLang || lang0 || "uk");

  // 2) промпти
  const systemHintBase = buildVisionHintByLang(lang);
  const userPromptBase = makeVisionUserPrompt(question, lang);

  // 3) порядок моделей
  const visionOrder = String(modelOrder || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "");

  // 4) JSON-спроба
  const jsonSystemHint = buildJsonSystemHint(lang);
  const jsonUserPrompt = buildJsonUserPrompt(userPromptBase);
  let parsed = null;
  let forceTextFallback = false;

  const j = await tryVisionJSON(env, visionOrder, jsonUserPrompt, jsonSystemHint, rawB64);
  if (j.raw) parsed = tryParseJsonLoose(j.raw); else forceTextFallback = !!j.forceTextFallback;

  // 5) успіх JSON
  if (parsed && typeof parsed === "object") {
    const containsText = !!parsed.contains_text;
    const ocrTextRaw   = containsText ? String(parsed.ocr_text || "").trim() : "";
    const landmarks    = Array.isArray(parsed.landmarks) ? parsed.landmarks : [];
    const desc         = normalizeText(String(parsed.description || "").trim());

    const lines = [];
    if (desc) lines.push(escHtml(desc));

    // OCR — без водяних знаків
    let ocrClean = "";
    if (containsText && ocrTextRaw && !isStockWatermark(ocrTextRaw)) {
      ocrClean = ocrTextRaw.replace(/\s+/g, " ").slice(0, 300);
      if (ocrClean) lines.push(`Текст на фото: "${escHtml(ocrClean)}"`);
    }

    // компактні іконки-лінки
    let added = 0;
    let mapLinks = [];
    if (landmarks.length) {
      const unique = dedupLandmarks(landmarks);
      const links = unique.slice(0, 4).map((lm) => {
        const icon = mapsIconLink(lm);
        const name = [lm.name, lm.city, lm.country].filter(Boolean).join(", ");
        let href;
        if (typeof lm.lat === "number" && typeof lm.lon === "number") {
          href = `https://maps.google.com/?q=${encodeURIComponent(`${lm.lat},${lm.lon}`)}`;
        } else {
          const q = [lm.name, lm.city, lm.country].filter(Boolean).join(", ");
          href = `https://maps.google.com/?q=${encodeURIComponent(q)}`;
        }
        mapLinks.push(href);
        return `• ${escHtml(name)} — ${icon}`;
      });
      if (links.length) {
        lines.push(lang.startsWith("uk") ? "Посилання на мапу:" : "Map links:");
        lines.push(...links);
        added += links.length;
      }
    }

    // бекап-детектор
    if (added === 0) {
      const backup = await detectLandmarks(env, { description: desc, ocrText: ocrTextRaw, lang });
      if (backup.length) {
        const items = formatLandmarkLines(backup, lang).map(s => {
          const m = s.match(/—\s+(https?:\/\/\S+)/);
          const url = m ? toMapsShort(m[1]) : null;
          if (url) mapLinks.push(url);
          const before = s.replace(/—\s+https?:\/\/\S+/, "— ↗︎");
          if (!url) return escHtml(before);
          return before.replace("↗︎", `<a href="${url}" rel="noopener noreferrer">↗︎</a>`);
        });
        lines.push(...items);
      }
    }

    return {
      text: lines.join("\n"),
      isHtml: true,
      meta: { containsText, ocrText: ocrClean || "", landmarks, mapLinks }
    };
  }

  // 6) фолбек у plain-vision
  if (!forceTextFallback) {
    const f = await tryVisionPlain(env, visionOrder, userPromptBase, systemHintBase, rawB64);
    if (f.text) {
      // Детектор отримує plain, користувач — HTML
      const plain   = postprocessVisionText(f.text);
      const cleaned = escHtml(plain);

      const backup = await detectLandmarks(env, { description: plain, ocrText: "", lang });
      let mapLinks = [];
      if (backup.length) {
        const lines = [cleaned, ...formatLandmarkLines(backup, lang).map(s => {
          const m = s.match(/—\s+(https?:\/\/\S+)/);
          const url = m ? toMapsShort(m[1]) : null;
          if (url) mapLinks.push(url);
          const before = escHtml(s.replace(/—\s+https?:\/\/\S+/, "— ↗︎"));
          if (!url) return before;
          return before.replace("↗︎", `<a href="${url}" rel="noopener noreferrer">↗︎</a>`);
        })];
        return { text: lines.join("\n"), isHtml: true, meta: { containsText: false, ocrText: "", landmarks: [], mapLinks } };
      }
      return { text: cleaned, isHtml: true, meta: { containsText: false, ocrText: "", landmarks: [], mapLinks: [] } };
    }
    forceTextFallback = !!f.forceTextFallback;
  }

  // 7) аварійний текстовий фолбек
  const textHint = buildTextFallbackHint(lang);
  const textMsg  = lang.startsWith("en") ? "Please provide a short, polite notice." : "Дай коротке ввічливе повідомлення.";
  const safeText = await askText(env, env.MODEL_ORDER_TEXT || env.MODEL_ORDER || "gemini:gemini-2.5-flash", textMsg, {
    systemHint: textHint, temperature: 0.1, max_tokens: 80,
  });
  return { text: normalizeText(safeText), isHtml: false, meta: { containsText: false, ocrText: "", landmarks: [], mapLinks: [] } };
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