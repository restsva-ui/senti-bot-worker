// src/routes/webhook.js
import { TG } from "../lib/tg.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { describeImage } from "../flows/visionDescribe.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";
import { getDriveMode, setDriveMode } from "../lib/driveMode.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { readStatut } from "../lib/kvChecklist.js";
import { enqueueLearn, listQueued, getRecentInsights } from "../lib/kvLearnQueue.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords } from "../apis/weather.js";
import { dateIntent, timeIntent, replyCurrentDate, replyCurrentTime } from "../apis/time.js";
import { json } from "../lib/utils.js";

const { ADMIN, energyLinks, mainKeyboard, sendPlain, askLocationKeyboard } = TG;

export default async function webhook(req, env) {
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const update = await req.json();
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg || !msg.from) return json({ ok: false, error: "No message" }, 400);

  const chatId = msg.chat?.id;
  const userId = msg.from.id;
  const textRaw = String(msg.text || msg.caption || "").trim();
  // ✨ Завжди визначай lang через pickReplyLanguage!
  const lang = pickReplyLanguage(msg, textRaw);
  const isAdmin = ADMIN(env, userId);

  // Хелпер для безпечних відповідей з автоматичним lang
  const safe = async (fn) => {
    try {
      await fn();
    } catch (e) {
      if (isAdmin) {
        await sendPlain(env, chatId, `❌ Error: ${String(e?.message || e).slice(0, 200)}`);
      } else {
        await sendPlain(env, chatId, t(lang, "default_reply"));
      }
    }
  };
// Збереження локації
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, t(lang, "saved_to_drive"), {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // /start мультимовний!
  if (textRaw === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      const name = msg?.from?.first_name || "друже";
      await sendPlain(
        env,
        chatId,
        `${t(lang, "hello_name", name)}\n${t(lang, "how_help")}\n${t(lang, "senti_tip")}`,
        { reply_markup: mainKeyboard(isAdmin) }
      );
    });
    return json({ ok: true });
  }

  // Далі — твоя логіка Codex, Vision, Drive, Learn та інші flows
  // ... (залишаєш усе як раніше, але всюди де sendPlain/t — ПЕРЕДАЄШ lang)
  // ... (у кожному async обробнику — визначаєш lang так само)

  // Звичайне повідомлення (AI-інференс, fallback)
  if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return;
      }
      await spendEnergy(env, userId, need, "text");
      // Інші модулі (dialog, self-tune, system hint) — всюди lang!
      await pushTurn(env, userId, "user", textRaw);
      await autoUpdateSelfTune(env, userId, lang).catch(() => {});
      const systemHint = await buildDialogHint(env, userId, lang);
      const order =
        String(env.MODEL_ORDER || "").trim() ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";
      const res = await askAnyModel(env, order, textRaw, { systemHint });
      const full = res?.text || t(lang, "default_reply");
      await pushTurn(env, userId, "assistant", full);
      await sendPlain(env, chatId, full);
    });
    return json({ ok: true });
  }

  // Дефолт: якщо нічого не спрацювало
  await sendPlain(env, chatId, t(lang, "default_reply"), {
    reply_markup: mainKeyboard(isAdmin),
  });
  return json({ ok: true });
}