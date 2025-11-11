// src/lib/visionHandler.js
// Винесена логіка обробки фото/віжн з webhook.js

import { describeImage } from "../flows/visionDescribe.js";
import {
  detectLandmarksFromText,
  formatLandmarkLines,
} from "../lib/landmarkDetect.js";

const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;

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
 * @param {any} env
 * @param {object} ctx { chatId, userId, msg, lang, caption }
 * @param {object} helpers { getEnergy, spendEnergy, energyLinks, sendPlain, tgFileUrl, urlToBase64 }
 */
export async function handleVisionMedia(env, ctx, helpers) {
  const { chatId, userId, msg, lang, caption } = ctx;
  const {
    getEnergy,
    spendEnergy,
    energyLinks,
    sendPlain,
    tgFileUrl,
    urlToBase64,
  } = helpers;

  const photoArr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!photoArr || !photoArr.length) {
    return false;
  }
  const ph = photoArr[photoArr.length - 1];

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      lang?.startsWith("uk")
        ? `Потрібно енергії: ${need}. Отримати: ${links.energy}`
        : `Need energy: ${need}. Get: ${links.energy}`
    );
    return true;
  }
  await spendEnergy(env, userId, need, "vision");

  const url = await tgFileUrl(env, ph.file_id);
  const imageBase64 = await urlToBase64(url);
  const prompt =
    caption ||
    (lang?.startsWith("uk")
      ? "Опиши, що на зображенні, коротко і по суті."
      : "Describe the image briefly and to the point.");

  try {
    const { text } = await describeImage(env, {
      chatId,
      tgLang: msg.from?.language_code,
      imageBase64,
      question: prompt,
      modelOrder:
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
    });

    await saveVisionMem(env, userId, {
      id: ph.file_id,
      url,
      caption,
      desc: text,
    });

    await sendPlain(env, chatId, `🖼️ ${text}`);

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
