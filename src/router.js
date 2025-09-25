// src/router.js

/**
 * Роутер для нових команд і кнопок:
 *  - /menu        — показати кнопки
 *  - /likepanel   — створити панель з лайком/дислайком
 *  - /stats       — звести статистику по всіх панелях у чаті
 *  - callback_query: "like", "dislike", "cmd:likepanel", "cmd:stats"
 *
 * Працює разом із src/index.js (де handleBasic обробляє /start, /ping, kv, echo).
 */

import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
} from "./lib/tg.js";

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */

/**
 * Головний вхід: отримує update, оточує try/catch і роутить.
 * Викликається fire-and-forget з index.js
 * @param {Env} env
 * @param {any} update
 */
export async function routeUpdate(env, update) {
  try {
    if (update.callback_query) {
      await handleCallback(env, update.callback_query);
      return;
    }
    if (update.message) {
      await handleMessage(env, update.message);
      return;
    }
  } catch (e) {
    console.error("routeUpdate:", e?.stack || e);
  }
}

/**
 * Обробка звичайних повідомлень (тільки наші нові команди)
 * @param {Env} env
 * @param {any} msg
 */
async function handleMessage(env, msg) {
  const chatId = msg.chat?.id;
  const text = (msg.text || "").trim();

  if (!chatId || !text) return;

  if (text === "/menu") {
    await showMenu(env, chatId);
    return;
  }

  if (text === "/likepanel") {
    await createLikePanel(env, chatId);
    return;
  }

  if (text === "/stats") {
    await sendStats(env, chatId);
    return;
  }

  // Інші команди/тексти обробляє базова логіка у handleBasic (index.js)
}

/**
 * Обробка callback-кнопок
 * @param {Env} env
 * @param {any} cb
 */
async function handleCallback(env, cb) {
  const data = cb.data || "";
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;
  const cbId = cb.id;

  // Безпечне ACK, щоб у користувача не крутилось "годинничок"
  const ack = (text = "✅") =>
    answerCallbackQuery(env, cbId, { text, show_alert: false }).catch(() => {});

  if (!chatId) {
    await ack();
    return;
  }

  // Меню: натиснули кнопку
  if (data === "cmd:likepanel") {
    await ack("Створюю панель…");
    await createLikePanel(env, chatId);
    return;
  }
  if (data === "cmd:stats") {
    await ack("Готую статистику…");
    await sendStats(env, chatId);
    return;
  }

  // Лайки
  if ((data === "like" || data === "dislike") && msgId) {
    await ack("Дякую!");
    await updateLikes(env, chatId, msgId, data);
    return;
  }

  await ack();
}

/**
 * Показати меню з кнопками
 */
async function showMenu(env, chatId) {
  const reply_markup = {
    inline_keyboard: [
      [{ text: "👍 Панель лайків", callback_data: "cmd:likepanel" }],
      [{ text: "📊 Статистика", callback_data: "cmd:stats" }],
    ],
  };

  await sendMessage(env, {
    chat_id: chatId,
    text: "Оберіть дію:",
    reply_markup,
  });
}

/**
 * Створити панель лайків (кнопки)
 */
async function createLikePanel(env, chatId) {
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "👍", callback_data: "like" },
        { text: "👎", callback_data: "dislike" },
      ],
    ],
  };

  await sendMessage(env, {
    chat_id: chatId,
    text: "Натисни, щоб проголосувати:",
    reply_markup,
  });
}

/**
 * Оновити лічильники лайків у KV та відредагувати текст повідомлення
 */
async function updateLikes(env, chatId, messageId, kind /* 'like'|'dislike' */) {
  const kv = env.STATE;
  if (!kv) return;

  const key = `likes:${chatId}:${messageId}`;
  let obj = { like: 0, dislike: 0 };

  try {
    const raw = await kv.get(key);
    if (raw) obj = JSON.parse(raw);
  } catch (_) {}

  obj[kind] = (obj[kind] || 0) + 1;

  await kv.put(key, JSON.stringify(obj));

  // Оновлюємо текст повідомлення (кнопки залишаються)
  const text = `Результат голосування:\n👍 ${obj.like}   👎 ${obj.dislike}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "👍", callback_data: "like" },
        { text: "👎", callback_data: "dislike" },
      ],
    ],
  };

  await editMessageText(env, {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup,
  });
}

/**
 * Звести просту статистику по всіх панелях лайків у конкретному чаті
 */
async function sendStats(env, chatId) {
  const kv = env.STATE;
  if (!kv) {
    await sendMessage(env, {
      chat_id: chatId,
      text: "❌ KV (STATE) не прив'язано — статистика недоступна.",
    });
    return;
  }

  const prefix = `likes:${chatId}:`;
  let totalLike = 0;
  let totalDislike = 0;

  try {
    let cursor = undefined;
    do {
      const { keys, cursor: next } = await kv.list({ prefix, cursor });
      for (const k of keys) {
        const raw = await kv.get(k.name);
        if (!raw) continue;
        try {
          const obj = JSON.parse(raw);
          totalLike += obj.like || 0;
          totalDislike += obj.dislike || 0;
        } catch {}
      }
      cursor = next;
    } while (cursor);
  } catch (e) {
    console.error("stats list error:", e?.stack || e);
  }

  const text = `📊 Статистика чату:\n\n👍 Вподобайок: ${totalLike}\n👎 Дизлайків: ${totalDislike}`;
  await sendMessage(env, { chat_id: chatId, text });
}