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

async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...extra,
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {}
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

// ── Time / TZ ─────────────────────────────────────────────────────────────────
function toLocalKyiv(ts, env) {
  const tz = (env.TZ || "Europe/Kyiv").trim() || "Europe/Kyiv";
  try {
    const d = new Date(ts);
    return d.toLocaleString("uk-UA", {
      timeZone: tz,
      hour12: false,
    });
  } catch {
    return ts;
  }
}

// ── Admin Keyboard ────────────────────────────────────────────────────────────
function adminKeyboard() {
  return {
    keyboard: [
      [{ text: "Drive ✅" }, { text: "List 10 📄" }],
      [{ text: "Backup URL ⬆️" }, { text: "Checklist ➕" }],
      [{ text: "Меню" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function showAdmin(env, chatId) {
  await sendMessage(
    env,
    chatId,
    [
      "*Senti Admin*",
      "— мінімальне меню керування:",
      "• Drive пінг і список файлів",
      "• Швидкий бекап за URL",
      "• Додавання в чеклист",
    ].join("\n"),
    { reply_markup: adminKeyboard() }
  );
}

// ── Персональні стейти (STATE_KV) ────────────────────────────────────────────
const STATE_KEY = (chatId) => `state:${chatId}`;

async function setState(env, chatId, stateObj) {
  try {
    await env.STATE_KV.put(STATE_KEY(chatId), JSON.stringify(stateObj), {
      expirationTtl: 60 * 10, // 10 хвилин на дію
    });
  } catch {}
}

async function getState(env, chatId) {
  try {
    const raw = await env.STATE_KV.get(STATE_KEY(chatId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function clearState(env, chatId) {
  try {
    await env.STATE_KV.delete(STATE_KEY(chatId));
  } catch {}
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

// ── Допоміжні для Drive показу ───────────────────────────────────────────────
async function showDriveStatusAndList(env, chatId) {
  try {
    await drivePing(env);
    await sendMessage(env, chatId, "🟢 Drive OK", {
      reply_markup: adminKeyboard(),
    });
  } catch (e) {
    await sendMessage(env, chatId, "🔴 Drive помилка: " + String(e?.message || e), {
      reply_markup: adminKeyboard(),
    });
    return;
  }

  try {
    const files = await driveList(env, 10);
    const mapped = files.map((f, i) => {
      const when = f.modifiedTime ? toLocalKyiv(f.modifiedTime, env) : "";
      return `${i + 1}. *${f.name}*\n   🕒 ${when}\n   🔗 ${f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`}`;
    });
    await sendMessage(
      env,
      chatId,
      ["*Останні 10 файлів:*", ...mapped].join("\n\n"),
      { reply_markup: adminKeyboard() }
    );
  } catch (e) {
    await sendMessage(env, chatId, "⚠️ Не вдалося отримати список файлів: " + String(e?.message || e));
  }
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

  // ── Спочатку перевіряємо, чи очікуємо відповідь від користувача ────────────
  const currentState = await getState(env, chatId);

  if (currentState?.type === "await_backup_url") {
    // чекаємо повідомлення з URL (і, можливо, назвою після пробілу)
    const m = text.match(/^(https?:\/\/\S+)(?:\s+(.+))?$/i);
    if (!m) {
      await sendMessage(env, chatId, "❗️Це не схоже на URL. Спробуй ще раз: `https://... [назва]`");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    const url = m[1];
    const name = (m[2] || "").trim();

    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `✅ Збережено: *${saved.name}*\n🔗 ${saved.link}`, {
        reply_markup: adminKeyboard(),
      });

      // Опціонально фіксуємо у чеклисті
      try {
        await driveAppendLog(env, "senti_checklist.md", `Backup: ${saved.name} — ${saved.link}`);
      } catch (_) {}

    } catch (e) {
      await sendMessage(env, chatId, "❌ Не вдалося зберегти: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (currentState?.type === "await_checklist_line") {
    const line = text.replace(/\s+/g, " ").trim();
    if (!line) {
      await sendMessage(env, chatId, "❗️Надішли один непорожній рядок для чеклиста.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    try {
      const r = await driveAppendLog(env, "senti_checklist.md", line);
      await sendMessage(
        env,
        chatId,
        `🟩 Додано у *senti_checklist.md*.\n🔗 ${r.webViewLink}`,
        { reply_markup: adminKeyboard() }
      );
    } catch (e) {
      await sendMessage(env, chatId, "❌ Помилка при додаванні: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ── Команди ────────────────────────────────────────────────────────────────

  // /start та головне меню одразу з адмін-кнопками
  if (text === "/start" || text === "/menu" || text === "Меню" || text === "/admin") {
    await showAdmin(env, chatId);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // Кнопки адмін-меню (reply keyboard)
  if (text === "Drive ✅") {
    await showDriveStatusAndList(env, chatId);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "List 10 📄") {
    try {
      const files = await driveList(env, 10);
      const mapped = files.map((f, i) => {
        const when = f.modifiedTime ? toLocalKyiv(f.modifiedTime, env) : "";
        return `${i + 1}. *${f.name}*\n   🕒 ${when}\n   🔗 ${f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`}`;
      });
      await sendMessage(env, chatId, ["*Останні 10 файлів:*", ...mapped].join("\n\n"), {
        reply_markup: adminKeyboard(),
      });
    } catch (e) {
      await sendMessage(env, chatId, "⚠️ Не вдалося отримати список файлів: " + String(e?.message || e));
    }
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "Backup URL ⬆️") {
    await setState(env, chatId, { type: "await_backup_url" });
    await sendMessage(
      env,
      chatId,
      "Надішли *URL* для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`",
      { reply_markup: adminKeyboard() }
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "Checklist ➕") {
    await setState(env, chatId, { type: "await_checklist_line" });
    await sendMessage(env, chatId, "Надішли *один рядок*, який додати в *senti_checklist.md*.", {
      reply_markup: adminKeyboard(),
    });
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /id
  if (text === "/id") {
    await sendMessage(env, chatId, `👤 Твій Telegram ID: \`${fromId}\``);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /log on|off|status
  if (text.startsWith("/log")) {
    const sub = (text.split(" ")[1] || "status").toLowerCase();
    const owner = await isOwner(env, fromId);

    if (!owner && sub !== "status") {
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

  // === Google Drive команди (зручно з телефона) ===
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
    // /gdrive save <url> [name...]
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
      try { await driveAppendLog(env, "senti_checklist.md", `Manual save: ${saved.name} — ${saved.link}`); } catch {}
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
        "/menu — головне меню (адмін-кнопки)",
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
        "Коли увімкнено автологування — пиши `+ завдання`, і я додам у чек-лист.",
      ].join("\n"),
      { reply_markup: adminKeyboard() }
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  return json({ ok: true });
}