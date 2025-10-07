// src/routes/webhook.js
import { drivePing, driveSaveFromUrl } from "../lib/drive.js";

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

// ── Autosave (Telegram → Drive) ──────────────────────────────────────────────
const AUTOSAVE_KEY = "autosave:enabled";

async function getAutosave(env) {
  try {
    const v = await env.STATE_KV.get(AUTOSAVE_KEY);
    return v === "1";
  } catch {
    return false;
  }
}
async function setAutosave(env, on) {
  try {
    await env.STATE_KV.put(AUTOSAVE_KEY, on ? "1" : "0", {
      expirationTtl: 60 * 60 * 24 * 365,
    });
    return true;
  } catch {
    return false;
  }
}

// Telegram getFile → direct URL
async function tgGetFileDirectUrl(env, fileId) {
  const api = `https://api.telegram.org/bot${env.BOT_TOKEN}`;
  const fileInfo = await fetch(`${api}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json());
  if (!fileInfo.ok) throw new Error("getFile failed: " + JSON.stringify(fileInfo));
  const filePath = fileInfo.result.file_path;
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
}

function sanitizeName(s, fallback) {
  const name = (s || fallback || "file.bin").replace(/[\\/:*?"<>|]/g, "_").trim();
  return name || (fallback || "file.bin");
}

async function autosaveIfNeeded(env, chatId, msg) {
  if (!(await getAutosave(env))) return false;

  // Фото: беремо найбільше
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    const direct = await tgGetFileDirectUrl(env, largest.file_id);
    const name = sanitizeName(`tg_photo_${largest.file_unique_id}.jpg`);
    const saved = await driveSaveFromUrl(env, direct, name);
    await sendMessage(env, chatId, `🖼️ Фото збережено: [${saved.name}](${saved.link})`);
    return true;
  }

  // Документ
  if (msg.document) {
    const d = msg.document;
    const direct = await tgGetFileDirectUrl(env, d.file_id);
    const name = sanitizeName(d.file_name || `tg_doc_${d.file_unique_id}`);
    const saved = await driveSaveFromUrl(env, direct, name);
    await sendMessage(env, chatId, `📄 Документ збережено: [${saved.name}](${saved.link})`);
    return true;
  }

  // Відео
  if (msg.video) {
    const v = msg.video;
    const direct = await tgGetFileDirectUrl(env, v.file_id);
    const name = sanitizeName(`tg_video_${v.file_unique_id}.mp4`);
    const saved = await driveSaveFromUrl(env, direct, name);
    await sendMessage(env, chatId, `🎞️ Відео збережено: [${saved.name}](${saved.link})`);
    return true;
  }

  return false;
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

  // /id
  if (text === "/id") {
    await sendMessage(env, chatId, `👤 Твій Telegram ID: \`${fromId}\``);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /autosave on|off|status (вмикати/вимикати може лише власник)
  if (text.startsWith("/autosave")) {
    const sub = (text.split(" ")[1] || "status").toLowerCase();
    const owner = await isOwner(env, fromId);

    if (!owner && sub !== "status") {
      await sendMessage(env, chatId, "🔒 Керувати autosave може лише власник. Використай `/autosave status`.");
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "on") {
      const ok = await setAutosave(env, true);
      await sendMessage(env, chatId, ok ? "✅ Autosave УВІМКНЕНО." : "⚠️ Не вдалося увімкнути autosave.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    if (sub === "off") {
      const ok = await setAutosave(env, false);
      await sendMessage(env, chatId, ok ? "⏹️ Autosave вимкнено." : "⚠️ Не вдалося вимкнути autosave.");
      await logReply(env, chatId);
      return json({ ok: true });
    }

    const on = await getAutosave(env);
    await sendMessage(env, chatId, `ℹ️ Autosave: *${on ? "ON" : "OFF"}*`);
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
        "/autosave status | /autosave on | /autosave off",
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
        "Коли увімкнено autosave — надсилай фото/док/відео, і я покладу їх у Drive.",
      ].join("\n")
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // Якщо це не команда — спробуємо автосейв медіа (якщо увімкнено)
  try {
    if (msg) {
      const saved = await autosaveIfNeeded(env, chatId, msg);
      if (saved) {
        await logReply(env, chatId);
        return json({ ok: true });
      }
    }
  } catch (e) {
    // проковтнемо, але не зламаємо вебхук
    await sendMessage(env, chatId, `⚠️ Autosave помилка: \`${String(e?.message || e)}\``);
  }

  return json({ ok: true });
}