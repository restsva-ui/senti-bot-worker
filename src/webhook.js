//////////////////////////////
// Senti-Lite 2025 — Webhook
//////////////////////////////

import { TG } from "../lib/tg.js";
import { aiRespond, aiVision } from "../lib/ai.js";
import { loadDialog, saveDialog } from "../lib/dialog.js";
import { getProfile, saveProfile } from "../lib/profile.js";
import { addReferral, getReferralStats } from "../lib/referrals.js";
import { giveEnergyBonus, getEnergy, spendEnergy } from "../lib/energy.js";
import { getStats, incMessages, incPhotos } from "../lib/stats.js";
import { addPhoto, getPhotoHistory } from "../lib/photos.js";
import { kvGet } from "../lib/kv.js";
import { t } from "../config/i18n.js";
import { json, log } from "../lib/utils.js";

export async function handleWebhook(req, env, ctx) {
  try {
    const update = await req.json();
    const tg = new TG(env.TG_TOKEN);

    const msg = update.message;
    const cb = update.callback_query;
    const webData =
      msg?.web_app_data ||
      update.web_app_data ||
      update.message?.web_app_data ||
      null;

    // Mini-App sendData
    if (webData) {
      return await handleWebApp(webData, tg, env);
    }

    // messages
    if (msg) {
      const uid = String(msg.from.id);
      const text = msg.text || "";

      let profile = await getProfile(env, uid);
      if (!profile) {
        profile = {
          uid,
          lang: "uk",
          created: Date.now(),
          energy: 30,
          premium: false,
        };
        await saveProfile(env, profile);
      }

      // photo → Vision
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

      // default → текстовий діалог
      return await handleDialog(msg, tg, env, profile);
    }

    // callbacks
    if (cb) {
      const uid = String(cb.from.id);
      return await handleCallback(cb, tg, env, uid);
    }

    return json({ ok: true });
  } catch (err) {
    log("WEBHOOK_ERROR", err);
    return json({ ok: false, error: String(err) }, 500);
  }
}
//////////////////////////////
// HANDLERS (чати, фото, старт)
//////////////////////////////

async function handleStart(msg, tg, env, profile) {
  const uid = profile.uid;
  const payload = msg.text.split(" ")[1];

  // реферал
  if (payload && payload !== uid) {
    await addReferral(env, payload, uid);
    await giveEnergyBonus(env, payload, 5); // бонус власнику лінка
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
            web_app: {
              url:
                env.APP_URL ||
                "https://senti-bot-worker.restsva.workers.dev/app",
            },
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

  await incMessages(env, uid);

  let dialog = await loadDialog(env, uid);
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

  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  await incPhotos(env, uid);
  await addPhoto(env, uid, base64);
  const analysis = await aiVision(env, base64);
  await spendEnergy(env, uid, 5);

  return tg.sendMessage(uid, analysis);
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
//////////////////////////////
// Mini-App (web_app_data)
//////////////////////////////

async function handleWebApp(webData, tg, env) {
  try {
    const payload = JSON.parse(webData.data || "{}");
    const uid = String(payload.uid || "");

    if (!uid) {
      return json({ ok: false, error: "no_uid" }, 400);
    }

    // 1) Аналіз фото з Mini-App
    if (payload.action === "photo_analyze" && payload.uploadKey) {
      const base64 = await kvGet(env, payload.uploadKey, null);
      if (!base64) {
        await tg.sendMessage(uid, "Не вдалося знайти завантажене фото.");
        return json({ ok: false, error: "no_image" }, 400);
      }

      await incPhotos(env, uid);
      await addPhoto(env, uid, base64);

      const analysis = await aiVision(env, base64);
      await spendEnergy(env, uid, 5);

      await tg.sendMessage(uid, analysis);
      return json({ ok: true });
    }

    // 2) Чат з Mini-App (прямий AI-діалог)
    if (payload.action === "chat_msg" && payload.text) {
      const text = String(payload.text || "");

      const energy = await getEnergy(env, uid);
      if (energy <= 0) {
        await tg.sendMessage(
          uid,
          "Енергія закінчилась. Запроси друга через /ref і отримай бонус."
        );
        return json({ ok: true });
      }

      await incMessages(env, uid);

      let dialog = await loadDialog(env, uid);
      dialog.push({ role: "user", content: text });

      const response = await aiRespond(env, dialog);

      dialog.push({ role: "assistant", content: response });
      await saveDialog(env, uid, dialog);
      await spendEnergy(env, uid, 1);

      await tg.sendMessage(uid, response);
      return json({ ok: true });
    }

    // 3) Відкриття реф-панелі з Mini-App
    if (payload.action === "ref_open") {
      await tg.sendMessage(
        uid,
        "Відкрий /ref у чаті з ботом, щоб побачити свою реферальну статистику."
      );
      return json({ ok: true });
    }

    // 4) Запит профілю (для Mini-App, якщо захочеш через sendData)
    if (payload.action === "profile_info") {
      const profile = await getProfile(env, uid);
      const stats = await getStats(env, uid);
      await tg.sendMessage(
        uid,
        `Профіль Senti:\n\nID: ${uid}\nПовідомлень: ${stats.messages}\nФото: ${stats.photos}\nПреміум: ${
          profile?.premium ? "Так" : "Ні"
        }`
      );
      return json({ ok: true });
    }

    // 5) Історія фото (через sendData, якщо знадобиться)
    if (payload.action === "history_info") {
      const photos = await getPhotoHistory(env, uid);
      await tg.sendMessage(
        uid,
        `Історія фото: ${photos.length} збережених (останній аналіз — через чат).`
      );
      return json({ ok: true });
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
