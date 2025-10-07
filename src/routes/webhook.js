// src/routes/webhook.js
import { getState, setState, clearState } from "../lib/state.js";
import { adminKeyboard } from "../lib/keyboard.js";
import { wantAdmin, handleAdminCommand, ensureBotCommands } from "./admin.js";
import { driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";

// === helpers ===
async function tgApi(env, method, body) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Жорсткий логінг усіх помилок Telegram
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("Telegram API error", method, res.status, t || res.statusText);
  } else {
    // опціонально можна увімкнути:
    // console.log("Telegram API ok", method);
  }
  return res;
}

function kbMarkup() {
  return { keyboard: adminKeyboard(), resize_keyboard: true };
}

async function reply(env, chatId, text, extra = {}) {
  // без parse_mode! (plain-text, щоби не ловити can't parse entities)
  return tgApi(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

function pickText(msg = {}) {
  if (msg.text) return String(msg.text);
  if (msg.caption) return String(msg.caption);
  return "";
}

function hasNonTextPayload(msg = {}) {
  return Boolean(
    msg.photo?.length ||
    msg.video ||
    msg.document ||
    msg.sticker ||
    msg.voice ||
    msg.audio ||
    msg.animation
  );
}

export default async function webhook(request, env, ctx) {
  // Перевірка секрету Telegram (якщо заданий)
  const tgSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_SECRET_TOKEN && tgSecret !== env.TELEGRAM_SECRET_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }

  // Безпечна реєстрація команд
  ctx.waitUntil(ensureBotCommands(env).catch(() => {}));

  let update = {};
  try {
    update = await request.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;

  if (!msg || !msg.chat?.id) return new Response("no message", { status: 200 });

  const chatId = msg.chat.id;
  const textRaw = pickText(msg).trim();
  const textLower = textRaw.toLowerCase();

  // ---- базові команди
  if (textLower === "/ping") {
    await reply(env, chatId, "pong 🟢");
    return new Response("ok");
  }
  if (textLower === "/help" || textLower === "/start") {
    await reply(
      env,
      chatId,
      "Доступні команди:\n/start — запустити бота\n/menu — адмін-меню\n/ping — перевірка зв'язку"
    );
    return new Response("ok");
  }

  // ---- state machine
  const state = (await getState(env, chatId)) || {};
  if (state.expect === "backup-url") {
    const parts = textRaw.split(/\s+/, 2);
    const url = parts[0];
    const name = parts[1] || "";
    if (!/^https?:\/\//i.test(url)) {
      await reply(env, chatId, "Надішли, будь ласка, валідний URL (http/https).");
      return new Response("ok");
    }
    try {
      const res = await driveSaveFromUrl(env, url, name);
      await reply(
        env,
        chatId,
        `Збережено: ${res.name}\nПосилання: ${res.link}`,
        { reply_markup: kbMarkup() }
      );
    } catch (e) {
      await reply(env, chatId, "Помилка збереження: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return new Response("ok");
  }

  if (state.expect === "append-checklist") {
    const line = textRaw.replace(/\r?\n/g, " ").trim();
    if (!line) {
      await reply(env, chatId, "Надішли один непорожній рядок.");
      return new Response("ok");
    }
    try {
      await driveAppendLog(env, "senti_checklist.md", line);
      await reply(env, chatId, "Додано до senti_checklist.md:\n• " + line, {
        reply_markup: kbMarkup(),
      });
    } catch (e) {
      await reply(env, chatId, "Помилка додавання: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return new Response("ok");
  }

  // ---- адмін меню
  if (wantAdmin(textRaw) || textLower === "/menu") {
    const res = await handleAdminCommand(env, chatId, "/menu");
    if (res) {
      await reply(env, chatId, res.text, { reply_markup: kbMarkup() });
      return new Response("ok");
    }
  }

  // ---- кнопки/команди з adminKeyboard
  const handled = await handleAdminCommand(env, chatId, textRaw);
  if (handled) {
    if (handled.expect) await setState(env, chatId, { expect: handled.expect });
    await reply(env, chatId, handled.text, {
      reply_markup: handled.keyboard ? kbMarkup() : undefined,
    });
    return new Response("ok");
  }

  // ---- не-текстові повідомлення
  if (!textRaw && hasNonTextPayload(msg)) {
    await reply(
      env,
      chatId,
      "Поки що я працюю з текстом та кнопками. Натисни «Меню» нижче або надішли /menu чи /ping.",
      { reply_markup: kbMarkup() }
    );
    return new Response("ok");
  }

  // ---- фолбек
  if (textRaw) {
    await reply(env, chatId, "Не впізнав команду. Спробуй /menu або /ping.", {
      reply_markup: kbMarkup(),
    });
  }
  return new Response("ok");
}