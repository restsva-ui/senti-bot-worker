// src/routes/webhook.js
import { drivePing, driveSaveFromUrl, driveAppendLog, driveReadTextByName } from "../lib/drive.js";
// [AI] новий імпорт
import { think } from "../lib/brain.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    // обережно з parse_mode — твій код місцями шле довільний текст
    disable_web_page_preview: true,
    ...extra,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    console.log("sendMessage fail:", r.status, j);
  }
  return j;
}

// Радіокнопки (якщо використовуєш)
const mainKeyboard = {
  keyboard: [[{ text: "Google Drive" }, { text: "Senti" }]],
  resize_keyboard: true,
};

// ── Webhook handler ───────────────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
  const chatId = msg?.chat?.id;
  const text = (update.message?.text || update.edited_message?.text || update.callback_query?.data || "").trim();

  if (!chatId) return json({ ok: true });

  try {
    // --- Команди (приклад) ---------------------------------------------------
    if (text === "/start") {
      await sendMessage(env, chatId, "Привіт! Я Senti 🤖", { reply_markup: mainKeyboard });
      return json({ ok: true });
    }

    if (text === "/admin_ping") {
      const r = await drivePing(env);
      await sendMessage(env, chatId, `✅ Admin Drive OK. filesCount: ${r.filesCount}`);
      return json({ ok: true });
    }

    // ...тут твої інші хендлери команд (/admin_list, /admin_checklist, /admin_setwebhook, тощо)
    // ...і збереження медіа у driveSaveFromUrl / autosave, як у твоєму файлі

    // --- Автозбереження медіа (фрагмент як у тебе) --------------------------
    // (залишаю як у твоєму коді; якщо тут логіка увімкнена — вона спрацює раніше за AI)

    // --- [AI] Відповідь «мозком», якщо це не команда/не медіа ----------------
    // Важливо: викликаємо think() ЛИШЕ якщо це звичайний текст, який не перехопили попередні гілки.
    if (text && !text.startsWith("/")) {
      const systemHint =
        "Ти — Senti, помічник у Telegram. Відповідай стисло та дружньо. Якщо просять зберегти файл — нагадай про Google Drive.";
      const out = await think(env, text, systemHint);
      await sendMessage(env, chatId, out);
      return json({ ok: true });
    }

    // Якщо зовсім нічого не підійшло:
    await sendMessage(env, chatId, "Готовий 👋", { reply_markup: mainKeyboard });
    return json({ ok: true });
  } catch (e) {
    console.log("webhook error:", e);
    await sendMessage(env, chatId, `❌ Помилка: ${String(e?.message || e)}`);
    return json({ ok: true });
  }
}

// HTML escape для /cl show (залишив як у тебе)
function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}