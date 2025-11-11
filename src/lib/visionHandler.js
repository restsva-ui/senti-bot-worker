// src/lib/visionHandler.js
// Винесена логіка обробки фото/віжн з webhook.js
// Використовує новий опис зображення з src/flows/visionDescribe.js
// та зберігає коротку памʼять по зображеннях у KV.

import { describeImage } from "../flows/visionDescribe.js";
import {
  detectLandmarksFromText,
  formatLandmarkLines,
} from "../lib/landmarkDetect.js";

const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;

// ---- vision short-memory (аналог того, що було в webhook.js)
async function loadVisionMem(env, userId) {
  try {
    const raw = await (env.STATE_KV || env.CHECKLIST_KV)?.get(
      VISION_MEM_KEY(userId),
      "text"
    );
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveVisionMem(env, userId, entry) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const arr = await loadVisionMem(env, userId);
    arr.unshift({
      id: entry.id,
      url: entry.url,
      caption: entry.caption || "",
      desc: entry.desc || "",
      ts: Date.now(),
    });
    await kv.put(VISION_MEM_KEY(userId), JSON.stringify(arr.slice(0, 20)), {
      expirationTtl: 60 * 60 * 24 * 180,
    });
  } catch {}
}

/**
 * Головний обробник фото, який ми тепер викликаємо з webhook.js
 *
 * @param {Env} env
 * @param {object} ctx - { chatId, userId, msg, lang, caption }
 * @param {object} deps - { getEnergy, spendEnergy, energyLinks, sendPlain, tgFileUrl, urlToBase64 }
 */
export async function handleVisionMedia(
  env,
  { chatId, userId, msg, lang, caption },
  { getEnergy, spendEnergy, energyLinks, sendPlain, tgFileUrl, urlToBase64 }
) {
  // беремо фото з повідомлення
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return false;
  const ph = arr[arr.length - 1]; // найбільше
  const fileId = ph.file_id;

  // енергія
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      lang?.startsWith("uk")
        ? `Потрібно ${need} енергії. Поповни тут: ${links.energy}`
        : `Need ${need} energy. Top up: ${links.energy}`
    );
    return true;
  }
  await spendEnergy(env, userId, need, "vision");

  // качаємо файл TG → base64
  try {
    const url = await tgFileUrl(env, fileId);
    const imageBase64 = await urlToBase64(url);

    // формуємо запит: або caption, або дефолт
    const question =
      caption ||
      (lang?.startsWith("uk")
        ? "Опиши, що на зображенні, коротко і по суті."
        : "Describe the image briefly and to the point.");

    // опис зображення через новий flows/visionDescribe.js
    const { text } = await describeImage(env, {
      chatId,
      tgLang: msg.from?.language_code,
      imageBase64,
      question,
      // порядок моделей можна не передавати — там уже стоїть gemini першим
    });

    // зберігаємо в памʼять
    await saveVisionMem(env, userId, {
      id: fileId,
      url,
      caption,
      desc: text,
    });

    // шлемо основну відповідь
    await sendPlain(env, chatId, `🖼️ ${text}`);

    // пробуємо витягти обʼєкти/локації з опису
    const landmarks = detectLandmarksFromText(text, lang);
    if (landmarks?.length) {
      const lines = formatLandmarkLines(landmarks, lang);
      await sendPlain(env, chatId, lines.join("\n"), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    await sendPlain(
      env,
      chatId,
      lang?.startsWith("uk")
        ? "Поки що не можу проаналізувати фото."
        : "Can't analyze this image right now."
    );
  }

  return true;
}
