// src/routes/webhook.js
// Telegram webhook з інтеграцією "мозку" та перевірками доступу/режиму диска.
// Додаємо Статут як системний підказник для AI на кожну текстову взаємодію.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";

// ── helpers ───────────────────────────────────────────────────────────────────
const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

async function sendMessage(env, chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
  });
  // не валимо запит, якщо Telegram повернув помилку
  await r.text().catch(() => {});
}

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";
const BTN_CHECK = "Checklist";

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }, { text: BTN_CHECK }]);
  return { keyboard: rows, resize_keyboard: true };
};

const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// ── STATE_KV: режим диска ─────────────────────────────────────────────────────
const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}
async function setDriveMode(env, userId, on) {
  await ensureState(env).put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 });
}
async function getDriveMode(env, userId) {
  return (await ensureState(env).get(DRIVE_MODE_KEY(userId))) === "1";
}

// ── медіа ─────────────────────────────────────────────────────────────────────
function pickPhoto(msg) {
  const a = msg.photo;
  if (!Array.isArray(a) || !a.length) return null;
  const ph = a[a.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` };
  }
  if (msg.video) {
    const v = msg.video;
    return { type: "video", file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { type: "audio", file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { type: "voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` };
  }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const d = await r.json().catch(() => ({}));
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}

async function handleIncomingMedia(env, chatId, userId, msg) {
  const att = detectAttachment(msg);
  if (!att) return false;
  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = abs(env, `/auth/start?u=${userId}`);
    await sendMessage(
      env,
      chatId,
      `Щоб зберігати у свій Google Drive — спочатку дозволь доступ:\n${authUrl}\n\nПотім натисни «${BTN_DRIVE}» ще раз.`
    );
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendMessage(env, chatId, `✅ Збережено на твоєму диску: ${saved?.name || att.name}`);
  return true;
}

// ── головний обробник вебхуку ────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  // захист секретом Telegram webhook
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    // GET /webhook — сигнал alive
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;

  const textRaw = update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
  const text = (textRaw || "").trim();
  if (!msg) return json({ ok: true });

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const isAdmin = ADMIN(env, userId);

  const safe = async (fn) => {
    try { await fn(); } catch (e) { await sendMessage(env, chatId, `❌ Помилка: ${String(e)}`); }
  };

  // /start
  if (text === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, "Привіт! Я Senti 🤖", { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // Кнопка Google Drive
  if (text === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendMessage(
          env,
          chatId,
          `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`
        );
        return;
      }
      await setDriveMode(env, userId, true);
      await sendMessage(env, chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", {
        reply_markup: mainKeyboard(isAdmin),
      });
      await sendMessage(env, chatId, "Переглянути вміст диска:", { reply_markup: inlineOpenDrive() });
    });
    return json({ ok: true });
  }

  // Кнопка Senti (вимкнути режим диска)
  if (text === BTN_SENTI) {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, "Режим диска вимкнено. Це звичайний чат Senti.", {
        reply_markup: mainKeyboard(isAdmin),
      });
    });
    return json({ ok: true });
  }

  // Декілька базових адмін-дій прямо з чату (посилання на HTML-панелі)
  if (text === BTN_CHECK && isAdmin) {
    await safe(async () => {
      const link = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      await sendMessage(env, chatId, `📋 Чеклист (HTML):\n${link}`);
    });
    return json({ ok: true });
  }

  if ((text === "Admin" || text === "/admin") && isAdmin) {
    await safe(async () => {
      const cl = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      const repo = abs(env, `/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      await sendMessage(
        env,
        chatId,
        `🛠 Адмін-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Вебхук GET: ${abs(env, "/webhook")}`
      );
    });
    return json({ ok: true });
  }

  // Якщо увімкнено режим диска — перехоплюємо та зберігаємо медіа
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // Якщо це не команда і не медіа — відповідаємо AI з підвантаженням Статуту
  if (text && !text.startsWith("/")) {
    try {
      const statut = await readStatut(env).catch(() => "");
      const systemHint =
        (statut ? `${statut.trim()}\n\n` : "") +
        "Ти — Senti, помічник у Telegram. Відповідай стисло та дружньо. " +
        "Якщо просять зберегти файл — нагадай про Google Drive та розділ Checklist/Repo.";
      const out = await think(env, text, systemHint); // якщо AI недоступний — впаде в catch
      await sendMessage(env, chatId, out || "🤔");
      return json({ ok: true });
    } catch {
      // fallback без AI
      await sendMessage(env, chatId, "Готовий 👋", { reply_markup: mainKeyboard(isAdmin) });
      return json({ ok: true });
    }
  }

  // дефолт
  await sendMessage(env, chatId, "Готовий 👋", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}