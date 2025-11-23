
//////////////////////////////
// Senti-Lite 2025
// New Webhook Core
//////////////////////////////

import { TG } from "./lib/tg.js";
import { aiRespond, aiVision } from "./lib/ai.js";
import { loadDialog, saveDialog } from "./lib/dialog.js";
import { getProfile, saveProfile } from "./lib/profile.js";
import { addReferral, getReferralStats } from "./lib/referrals.js";
import { giveEnergyBonus, getEnergy } from "./lib/energy.js";
import { t } from "./config/i18n.js";
import { json } from "./lib/utils.js";
import { STATUTE_SENTI } from "./config/consts.js";

export async function handleWebhook(req, env, ctx) {
  try {
    const update = await req.json();
    const tg = new TG(env.TG_TOKEN);

    const msg = update.message;
    const cb = update.callback_query;

    // WebApp data (MiniApp)
    if (update.web_app_data) {
      return await handleWebApp(update.web_app_data, tg, env);
    }

    // messages
    if (msg) {
      const uid = msg.from.id.toString();
      const text = msg.text || "";

      // ensure profile exists
      let profile = await getProfile(env, uid);
      if (!profile) {
        profile = { uid, lang: "uk", created: Date.now(), energy: 30 };
        await saveProfile(env, profile);
      }

      // photo message → Vision mode
      if (msg.photo) {
        return await handlePhoto(msg, tg, env, profile);
      }

      // commands
      if (text.startsWith("/start")) {
        return await handleStart(msg, tg, env, profile);
      }

      if (text === "/ref") {
        return await handleReferralMenu(msg, tg, env, profile);
      }

      // regular dialog → Assistant mode
      return await handleDialog(msg, tg, env, profile);
    }

    // callbacks (кнопки)
    if (cb) {
      const uid = cb.from.id.toString();
      return await handleCallback(cb, tg, env, uid);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.toString() }, 500);
  }
}
//////////////////////////////
// HANDLERS
//////////////////////////////

async function handleStart(msg, tg, env, profile) {
  const uid = profile.uid;

  // реферал?
  const payload = msg.text.split(" ")[1];
  if (payload && payload !== uid) {
    await addReferral(env, payload, uid);
    await giveEnergyBonus(env, uid, 5);
  }

  const text =
    "Вітаю! Це Senti — інтелектуальний помічник з фотоаналізом, AI-відповідями та реферальними бонусами.\n\n" +
    "Спробуй:\n" +
    "• надішли фото — я проаналізую\n" +
    "• напиши запит — дам точну відповідь\n" +
    "• отримай бонуси через /ref\n\n" +
    "Відкрити міні-додаток Senti:\n" +
    "Натисни кнопку нижче";

  await tg.sendMessage(uid, text, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Відкрити Senti App",
            web_app: { url: env.APP_URL || "https://YOURDOMAIN/app" },
          },
        ],
      ],
    },
  });
}

async function handleDialog(msg, tg, env, profile) {
  const uid = profile.uid;
  const text = msg.text;

  // енергія
  const energy = await getEnergy(env, uid);
  if (energy <= 0) {
    return tg.sendMessage(
      uid,
      "Енергія вичерпана. Запроси друга через /ref і отримай +5."
    );
  }

  // історія діалогу
  const dialog = await loadDialog(env, uid);
  dialog.push({ role: "user", content: text });

  const response = await aiRespond(env, dialog);

  dialog.push({ role: "assistant", content: response });
  await saveDialog(env, uid, dialog);

  return tg.sendMessage(uid, response);
}

async function handlePhoto(msg, tg, env, profile) {
  const uid = profile.uid;
  const photo = msg.photo[msg.photo.length - 1]; // highest quality

  const fileId = photo.file_id;
  const url = await tg.getFileLink(fileId);

  const analysis = await aiVision(env, url);
  return tg.sendMessage(uid, analysis);
}
//////////////////////////////
// CALLBACKS & MINI-APP
//////////////////////////////

async function handleCallback(cb, tg, env, uid) {
  const data = cb.data;

  if (data === "ref_stats") {
    const stats = await getReferralStats(env, uid);
    return tg.answerCallback(cb, `Рефералів: ${stats.count}`);
  }

  if (data === "ref_link") {
    const link = `https://t.me/${env.BOT_USERNAME}?start=${uid}`;
    return tg.answerCallback(cb, `Твоє посилання:\n${link}`);
  }

  return tg.answerCallback(cb, "Готово");
}

// Mini-App WebAppData
async function handleWebApp(data, tg, env) {
  // Дані приходять з webapp/app.js
  // Напр. { action: "analyze", url: "..." }

  try {
    const payload = JSON.parse(data.data);
    const uid = payload.uid;

    if (payload.action === "photo_analyze") {
      const analysis = await aiVision(env, payload.url);
      await tg.sendMessage(uid, analysis);
    }

    if (payload.action === "ping") {
      await tg.sendMessage(uid, "Senti App активний");
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.toString() }, 500);
  }
}

async function handleReferralMenu(msg, tg, env, profile) {
  const uid = profile.uid;

  const stats = await getReferralStats(env, uid);
  const link = `https://t.me/${env.BOT_USERNAME}?start=${uid}`;

  const text =
    "Реферальна програма Senti:\n\n" +
    `Запрошено друзів: *${stats.count}*\n` +
    "За кожного — +5 енергії.\n\n" +
    "Твоє посилання:\n" +
    link;

  return tg.sendMessage(uid, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Скопіювати лінк", callback_data: "ref_link" }],
        [{ text: "Статистика", callback_data: "ref_stats" }],
      ],
    },
  });
}
//////////////////////////////
// END OF WEBHOOK
//////////////////////////////

// експорт для index.js
export { handleWebhook };
