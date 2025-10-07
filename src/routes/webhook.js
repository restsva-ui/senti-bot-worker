// src/routes/webhook.js
import {
  drivePing,
  driveSaveFromUrl,
  driveList,
  driveAppendLog,
} from "../lib/drive.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

async function tgPost(url, body) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {}
}

async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  await tgPost(url, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function sendJSON(env, chatId, obj, extra = {}) {
  const pretty = "```\n" + JSON.stringify(obj, null, 2) + "\n```";
  await sendMessage(env, chatId, pretty, extra);
}

async function logReply(env, chatId) {
  try {
    await env.STATE_KV.put(`last-reply:${chatId}`, new Date().toISOString(), {
      expirationTtl: 60 * 60 * 24,
    });
  } catch (_) {}
}

async function isOwner(env, fromId) {
  try {
    const raw = String(env.OWNER_ID ?? "").trim();
    if (!raw) return false;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return list.includes(String(fromId).trim());
  } catch {
    return false;
  }
}

// ── Автологування у STATE_KV ─────────────────────────────────────────────────
const AUTOLOG_KEY = "autolog:enabled";

async function getAutolog(env) {
  try {
    const v = await env.STATE_KV.get(AUTOLOG_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

async function setAutolog(env, on) {
  try {
    await env.STATE_KV.put(AUTOLOG_KEY, on ? "1" : "0", {
      expirationTtl: 60 * 60 * 24 * 365,
    });
    return true;
  } catch {
    return false;
  }
}

// ── TODO у TODO_KV ───────────────────────────────────────────────────────────
const todoKey = (chatId) => `todo:${chatId}`;

async function loadTodos(env, chatId) {
  try {
    const raw = await env.TODO_KV.get(todoKey(chatId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveTodos(env, chatId, list) {
  try {
    await env.TODO_KV.put(todoKey(chatId), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

async function addTodo(env, chatId, text) {
  const list = await loadTodos(env, chatId);
  const exists = list.some((x) => x.text.toLowerCase() === text.toLowerCase());
  if (exists) return { added: false, list };
  const item = { text, ts: Date.now() };
  list.push(item);
  await saveTodos(env, chatId, list);
  return { added: true, list };
}

async function removeTodoByIndex(env, chatId, idx1) {
  const list = await loadTodos(env, chatId);
  const i = idx1 - 1;
  if (i < 0 || i >= list.length) return { ok: false, list };
  const [removed] = list.splice(i, 1);
  await saveTodos(env, chatId, list);
  return { ok: true, removed, list };
}

function formatTodos(list) {
  if (!list.length) return "✅ Чек-лист порожній.";
  return "📝 Чек-лист:\n" + list.map((x, i) => `${i + 1}. ${x.text}`).join("\n");
}

// ── Admin helpers/state ──────────────────────────────────────────────────────
const ADMIN_EXPECT = {
  BACKUP_URL: (chatId) => `admin:expect:backup-url:${chatId}`,
  CHECKLINE: (chatId) => `admin:expect:checkline:${chatId}`,
};

const CHECKLIST_FILE = "senti_checklist.md";

function adminKeyboard() {
  return {
    keyboard: [
      [
        { text: "Drive ✅" },
        { text: "List 10 📄" },
      ],
      [
        { text: "Backup URL ⬆️" },
        { text: "Checklist ➕" },
      ],
      [{ text: "Меню" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function ensureBotCommands(env) {
  // зареєструємо стандартні команди + /admin
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`;
  const commands = [
    { command: "start", description: "Запустити бота" },
    { command: "help", description: "Довідка" },
    { command: "ping", description: "Перевірка зв'язку" },
    { command: "menu", description: "Меню" },
    { command: "todo", description: "Показати чек-лист" },
    { command: "log", description: "Автолог: status/on/off" },
    { command: "gdrive", description: "Drive команди" },
    { command: "admin", description: "Адмін-панель" },
  ];
  await tgPost(url, { commands });
}

// ── Основний обробник ────────────────────────────────────────────────────────
export default async function webhook(request, env, ctx) {
  let update;
  try {
    update = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const msg =
    update.message ||
    update.edited_message ||
    update.callback_query?.message ||
    null;

  const chatId = msg?.chat?.id;
  const fromId =
    update.message?.from?.id ??
    update.edited_message?.from?.id ??
    update.callback_query?.from?.id ??
    null;

  const textRaw =
    update.message?.text ??
    update.edited_message?.text ??
    update.callback_query?.data ??
    "";

  const text = (textRaw || "").trim();
  if (!chatId) return json({ ok: true });

  // Під час /start /admin /menu — реєструємо команди
  if (text === "/start" || text === "/menu" || text === "/admin") {
    ctx.waitUntil(ensureBotCommands(env));
  }

  // ── ADMIN: кнопки як прості текстові тригери ───────────────────────────────
  const owner = await isOwner(env, fromId);

  // /admin — показати панель
  if (text === "/admin") {
    if (!owner) {
      await sendMessage(env, chatId, "🔒 Доступ лише для власника.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    await sendMessage(
      env,
      chatId,
      "Senti Admin\n— мінімальне меню керування:\n• Drive пінг і список файлів\n• Швидкий бекап за URL\n• Додавання в чеклист",
      { reply_markup: adminKeyboard() }
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // Натискання на кнопки адмінки
  if (owner && text === "Drive ✅") {
    try {
      await drivePing(env);
      await sendMessage(env, chatId, "🟢 Drive OK");
    } catch (e) {
      await sendMessage(env, chatId, "❌ Drive помилка: " + String(e?.message || e));
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (owner && text === "List 10 📄") {
    try {
      const files = await driveList(env, 10);
      await sendJSON(env, chatId, { ok: true, files });
      await sendMessage(env, chatId, "Відповідай *рядком*, який додати в `senti_checklist.md`");
    } catch (e) {
      await sendMessage(env, chatId, "❌ List помилка: " + String(e?.message || e));
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (owner && text === "Backup URL ⬆️") {
    await env.STATE_KV.put(ADMIN_EXPECT.BACKUP_URL(chatId), "1", { expirationTtl: 600 });
    await sendMessage(
      env,
      chatId,
      "Надішли *URL* для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`"
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (owner && text === "Checklist ➕") {
    await env.STATE_KV.put(ADMIN_EXPECT.CHECKLINE(chatId), "1", { expirationTtl: 600 });
    await sendMessage(env, chatId, "Надішли *один рядок*, який додати в `senti_checklist.md`.");
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (owner && text === "Меню") {
    await sendMessage(env, chatId, "Меню оновлено.", { reply_markup: adminKeyboard() });
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // Очікування відповіді після "Backup URL ⬆️"
  if (owner && (await env.STATE_KV.get(ADMIN_EXPECT.BACKUP_URL(chatId))) === "1") {
    await env.STATE_KV.delete(ADMIN_EXPECT.BACKUP_URL(chatId));
    // Формат: "<url> [name ...]"
    const parts = text.split(/\s+/);
    const url = parts[0];
    const name = parts.length > 1 ? parts.slice(1).join(" ") : "";
    if (!/^https?:\/\//i.test(url)) {
      await sendMessage(env, chatId, "❗️ Це не схоже на URL. Спробуй ще раз через кнопку *Backup URL ⬆️*.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `📤 Збережено: *${saved.name}*\n🔗 ${saved.link}`, {
        reply_markup: adminKeyboard(),
      });
    } catch (e) {
      await sendMessage(env, chatId, "❌ Upload помилка: " + String(e?.message || e), {
        reply_markup: adminKeyboard(),
      });
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // Очікування відповіді після "Checklist ➕"
  if (owner && (await env.STATE_KV.get(ADMIN_EXPECT.CHECKLINE(chatId))) === "1") {
    await env.STATE_KV.delete(ADMIN_EXPECT.CHECKLINE(chatId));
    const line = text.trim();
    if (!line) {
      await sendMessage(env, chatId, "❗️ Порожній рядок. Спробуй ще раз через кнопку *Checklist ➕*.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    try {
      const res = await driveAppendLog(env, CHECKLIST_FILE, line);
      await sendMessage(
        env,
        chatId,
        `✅ Додано в чеклист (${res.action}).\n🔗 ${res.webViewLink}`,
        { reply_markup: adminKeyboard() }
      );
    } catch (e) {
      await sendMessage(env, chatId, "❌ Append помилка: " + String(e?.message || e), {
        reply_markup: adminKeyboard(),
      });
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // === Стандартні команди ===

  // /id
  if (text === "/id") {
    await sendMessage(env, chatId, `👤 Твій Telegram ID: \`${fromId}\``);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /log on|off|status
  if (text.startsWith("/log")) {
    const sub = (text.split(" ")[1] || "status").toLowerCase();
    const ownerOnly = await isOwner(env, fromId);

    if (!ownerOnly && sub !== "status") {
      await sendMessage(
        env,
        chatId,
        "🔒 Керувати автологуванням може лише власник. Використай `/log status` або `/id`."
      );
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "on") {
      const ok = await setAutolog(env, true);
      const now = await getAutolog(env);
      await sendMessage(
        env,
        chatId,
        ok && now
          ? "🟢 Автологування УВІМКНЕНО. Пиши завдання з префіксом `+`."
          : "⚠️ Не вдалося увімкнути автологування (KV недоступне?)."
      );
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "off") {
      const ok = await setAutolog(env, false);
      const now = await getAutolog(env);
      await sendMessage(
        env,
        chatId,
        ok && !now
          ? "⚪️ Автологування вимкнено."
          : "⚠️ Не вдалося вимкнути автологування (KV недоступне?)."
      );
      await logReply(env, chatId);
      return json({ ok: true });
    }

    const enabled = await getAutolog(env);
    await sendMessage(
      env,
      chatId,
      `ℹ️ Автологування: ${enabled ? "УВІМКНЕНО" : "вимкнено"}.`
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /todo, /todo clear, /done N
  if (text === "/todo") {
    const list = await loadTodos(env, chatId);
    await sendMessage(env, chatId, formatTodos(list));
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "/todo clear") {
    await saveTodos(env, chatId, []);
    await sendMessage(env, chatId, "🧹 Список очищено.");
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (/^\/done\s+\d+$/i.test(text)) {
    const n = parseInt(text.split(/\s+/)[1], 10);
    const { ok, removed, list } = await removeTodoByIndex(env, chatId, n);
    await sendMessage(
      env,
      chatId,
      ok ? `✅ Готово: ${removed.text}\n\n${formatTodos(list)}` : "❌ Не той номер."
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // === Google Drive команди ===
  if (text === "/gdrive ping") {
    try {
      await drivePing(env);
      await sendMessage(env, chatId, "🟢 Drive доступний, папка знайдена.");
    } catch (e) {
      await sendMessage(env, chatId, "❌ Drive недоступний: " + String(e?.message || e));
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /gdrive save <url> [name]
  if (/^\/gdrive\s+save\s+/i.test(text)) {
    const parts = text.split(/\s+/);
    const url = parts[2];
    const name = parts.length > 3 ? parts.slice(3).join(" ") : "";
    if (!url) {
      await sendMessage(env, chatId, "ℹ️ Використання: `/gdrive save <url> [назва.zip]`");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `📤 Залив у Drive: *${saved.name}*\n🔗 ${saved.link}`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ Не вдалося залити: " + String(e?.message || e));
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /ping і /help
  if (text === "/ping") {
    await sendMessage(env, chatId, "🏓 Pong!");
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "/help") {
    await sendMessage(
      env,
      chatId,
      [
        "*Команди:*",
        "/ping, /id",
        "/log status | /log on | /log off",
        "/todo — показати список",
        "/done N — завершити пункт №N",
        "/todo clear — очистити список",
        "",
        "*Drive:*",
        "/gdrive ping — перевірка доступу до папки",
        "/gdrive save <url> [назва] — зберегти файл із URL у Google Drive",
        "",
        "*Admin:*",
        "/admin — адмін-панель (кнопки керування)",
        "",
        "Коли увімкнено автологування — пиши `+ завдання`, і я додам у чек-лист.",
      ].join("\n")
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // Автологування: + пункт у чек-лист
  if (await getAutolog(env)) {
    const m = text.match(/^\s*\+\s*(.+)$/s);
    if (m) {
      const itemText = m[1].trim();
      if (itemText) {
        const { added, list } = await addTodo(env, chatId, itemText);
        await sendMessage(
          env,
          chatId,
          added
            ? `➕ Додав у чек-лист: ${itemText}\n\n${formatTodos(list)}`
            : `ℹ️ Вже є в списку: ${itemText}\n\n${formatTodos(list)}`
        );
        await logReply(env, chatId);
        return json({ ok: true });
      }
    }
  }

  return json({ ok: true });
}