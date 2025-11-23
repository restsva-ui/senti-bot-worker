//////////////////////////////
// Senti-Lite 2025 — Webhook
//////////////////////////////

import { TG } from "../lib/tg.js";
import { aiRespond, aiVision } from "../lib/ai.js";
import { loadDialog, saveDialog } from "../lib/dialog.js";
import { getProfile, saveProfile } from "../lib/profile.js";
import { addReferral, getReferralStats } from "../lib/referrals.js";
import { giveEnergyBonus, getEnergy, spendEnergy } from "../lib/energy.js";
import { t } from "../config/i18n.js";
import { json } from "../lib/utils.js";

export async function handleWebhook(req, env, ctx) {
  try {
    const update = await req.json();
    const tg = new TG(env.TG_TOKEN);

    const msg = update.message;
    const cb = update.callback_query;
    const webData = msg?.web_app_data || update.web_app_data || null;

    if (webData) {
      return await handleWebApp(webData, tg, env);
    }

    if (msg) {
      const uid = String(msg.from.id);
      const text = msg.text || "";

      let profile = await getProfile(env, uid);
      if (!profile) {
        profile = { uid, lang: "uk", created: Date.now(), energy: 30 };
        await saveProfile(env, profile);
      }

      if (msg.photo) {
        return await handlePhoto(msg, tg, env, profile);
      }

      if (text.startsWith("/start")) {
        return await handleStart(msg, tg, env, profile);
      }

      if (text === "/ref") {
        return await handleReferralMenu(msg, tg, env, profile);
      }

      return await handleDialog(msg, tg, env, profile);
    }

    if (cb) {
      const uid = String(cb.from.id);
      return await handleCallback(cb, tg, env, uid);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

async function handleStart(msg, tg, env, profile) {
  const uid = profile.uid;
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
    "Відкрити міні-додаток Senti — натисни кнопку нижче.";

  await tg.sendMessage(uid, text, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Відкрити Senti App",
            web_app: { url: env.APP_URL || "https://senti-bot-worker.restsva.workers.dev/app" },
          },
        ],
      ],
    },
  });
}

async function handleDialog(msg, tg, env, profile) {
  const uid = profile.uid;
  const text = msg.text || "";

  const energy = await getEnergy(env, uid);
  if (energy <= 0) {
    return tg.sendMessage(uid, t("no_energy", profile.lang));
  }

  const dialog = await loadDialog(env, uid);
  dialog.push({ role: "user", content: text });

  const response = await aiRespond(env, dialog);

  dialog.push({ role: "assistant", content: response });
  await saveDialog(env, uid, dialog);
  await spendEnergy(env, uid, 1);

  return tg.sendMessage(uid, response);
}

async function handlePhoto(msg, tg, env, profile) {
  const uid = profile.uid;
  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;

  const url = await tg.getFileLink(fileId);
  if (!url) {
    return tg.sendMessage(uid, "Не вдалося отримати фото.");
  }

  // простий проксі: завантажуємо зображення і кодуємо в base64
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const analysis = await aiVision(env, base64);
  await spendEnergy(env, uid, 5);

  return tg.sendMessage(uid, analysis);
}

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

async function handleWebApp(webData, tg, env) {
  try {
    const payload = JSON.parse(webData.data || "{}");
    const uid = String(payload.uid || "");

    if (payload.action === "photo_analyze" && payload.uploadKey) {
      const base64 = await env.DIALOG_KV.get(payload.uploadKey);
      if (!base64) {
        await tg.sendMessage(uid, "Не вдалося знайти завантажене фото.");
        return json({ ok: false, error: "no_image" }, 400);
      }
      const analysis = await aiVision(env, base64);
      await tg.sendMessage(uid, analysis);
      return json({ ok: true });
    }

    if (payload.action === "chat_msg" && payload.text) {
      // простий прокид у звичайний діалог — Telegram сам надішле текст як повідомлення,
      // але на випадок прямого виклику можна відповісти чимось службовим.
      await tg.sendMessage(uid, "Повідомлення надіслано. Відкрий звичайний чат із ботом, щоб побачити відповідь.");
      return json({ ok: true });
    }

    if (payload.action === "ref_open") {
      await tg.sendMessage(uid, "Відкрий /ref у чаті з ботом, щоб побачити свою реферальну статистику.");
      return json({ ok: true });
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
