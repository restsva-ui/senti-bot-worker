// src/routes/webhook.js
import { getState, setState, clearState } from "../lib/state.js";
import { adminKeyboard } from "../lib/keyboard.js";
import { wantAdmin, handleAdminCommand, ensureBotCommands } from "./admin.js";
import { driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";

function tgApi(env, method, body) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reply(env, chatId, text, extra = {}) {
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...extra,
  });
}

function pickText(msg = {}) {
  // 1) звичайний текст
  if (msg.text) return String(msg.text);
  // 2) підпис до фото/відео/документа
  if (msg.caption) return String(msg.caption);
  // 3) команди з кнопок через entities (рідко)
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
  // реєструємо команди раз у кілька годин (дешево і безпечно)
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

  // --- /ping & /help швидкі відповіді
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

  // --- Обробка очікуваних кроків (state machine)
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
        `✅ Збережено: *${res.name}*\n🔗 ${res.link}`,
        { reply_markup: { keyboard: adminKeyboard(), resize_keyboard: true } }
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
      await reply(env, chatId, "Надішли *один* непорожній рядок.");
      return new Response("ok");
    }
    try {
      await driveAppendLog(env, "senti_checklist.md", line);
      await reply(env, chatId, "✅ Додано до `senti_checklist.md`:\n• " + line, {
        reply_markup: { keyboard: adminKeyboard(), resize_keyboard: true },
      });
    } catch (e) {
      await reply(env, chatId, "Помилка додавання: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return new Response("ok");
  }

  // --- Адмін меню / кнопки
  if (wantAdmin(textRaw) || textLower === "/menu") {
    const res = await handleAdminCommand(env, chatId, "/menu");
    if (res) {
      await reply(env, chatId, res.text, {
        reply_markup: { keyboard: res.keyboard, resize_keyboard: true },
      });
      return new Response("ok");
    }
  }

  // спробуємо інтерпретувати як кнопку адмін-панелі
  const handled = await handleAdminCommand(env, chatId, textRaw);
  if (handled) {
    if (handled.expect) {
      await setState(env, chatId, { expect: handled.expect });
    }
    await reply(env, chatId, handled.text, {
      reply_markup: handled.keyboard
        ? { keyboard: handled.keyboard, resize_keyboard: true }
        : undefined,
    });
    return new Response("ok");
  }

  // --- Не текст: дати зрозуміти, що все ок, але потрібен текст/команда
  if (!textRaw && hasNonTextPayload(msg)) {
    await reply(
      env,
      chatId,
      "Я поки працюю з текстом та кнопками. Натисни *Меню* нижче або надішли одну з команд: /menu /ping",
      { reply_markup: { keyboard: adminKeyboard(), resize_keyboard: true } }
    );
    return new Response("ok");
  }

  // --- Фолбек
  if (textRaw) {
    await reply(
      env,
      chatId,
      "Не впізнав команду. Спробуй /menu або /ping 🙂",
      { reply_markup: { keyboard: adminKeyboard(), resize_keyboard: true } }
    );
  }
  return new Response("ok");
}