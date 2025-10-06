import { json, sendMessage, logReply, isOwner, getAutolog, setAutolog } from "../lib/utils.js";
import { loadTodos, saveTodos, addTodo, removeTodoByIndex, formatTodos } from "../lib/todo.js";
import { getBaseSnapshot, setBaseSnapshot } from "../lib/snapshot-manager.js";

export default async function webhook(request, env, ctx) {
  let update;
  try { update = await request.json(); }
  catch { return json({ ok: false, error: "bad json" }, { status: 400 }); }

  const msg = update.message || update.edited_message || update.callback_query?.message || null;
  const chatId = msg?.chat?.id;
  const fromId =
    update.message?.from?.id ??
    update.edited_message?.from?.id ??
    update.callback_query?.from?.id ?? null;

  const textRaw =
    update.message?.text ??
    update.edited_message?.text ??
    update.callback_query?.data ?? "";
  const text = (textRaw || "").trim();

  if (!chatId) return json({ ok: true });

  // /id
  if (text === "/id") {
    await sendMessage(env, chatId, `👤 Твій Telegram ID: \`${fromId}\``);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ---- /snapshot команди (лише власник) ----
  // /snapshot           → показати базовий снепшот
  // /snapshot setdrive  → встановити Drive-архів як базу (очікує URL у відповіді-reply або наступним меседжем)
  // /snapshot setsha <owner/repo> <sha> → зафіксувати git-архів як базу
  if (text.startsWith("/snapshot")) {
    if (!(await isOwner(env, fromId))) {
      await sendMessage(env, chatId, "🔒 Лише власник.");
      await logReply(env, chatId);
      return json({ ok: true });
    }

    const parts = text.split(/\s+/);
    const sub = (parts[1] || "").toLowerCase();

    if (!sub) {
      const base = await getBaseSnapshot(env);
      if (!base) {
        await sendMessage(env, chatId, "ℹ️ Базовий снепшот ще не встановлено.");
      } else {
        const when = new Date(base.createdTs).toLocaleString("uk-UA", { timeZone: env.TZ ?? "Europe/Kyiv" });
        await sendMessage(env, chatId,
          `📦 Базовий снепшот:\n• sha: ${base.sha || "—"}\n• url: ${base.url}\n• note: ${base.note || "—"}\n• when: ${when}`
        );
      }
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "setdrive") {
      // Очікуємо, що ти відправиш у чат наступним повідомленням ПУБЛІЧНИЙ URL Google Drive архіву
      const hint = "Надішли публічний *URL Google Drive* архіву (повідомленням), і я встановлю його як базовий снепшот.\nПриклад: https://drive.google.com/file/d/..../view?usp=sharing";
      await sendMessage(env, chatId, hint);
      // простий режим: запам'ятати у STATE_KV маркер і далі перехопити наступне повідомлення (не реалізовуємо FSM, тримаємо просто)
      await env.STATE_KV.put(`snapshot:await_url:${chatId}`, "1", { expirationTtl: 300 });
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "setsha") {
      const repo = parts[2] || "";
      const sha = parts[3] || "";
      if (!repo || !sha) {
        await sendMessage(env, chatId, "Формат: `/snapshot setsha owner/repo <sha>`");
        await logReply(env, chatId);
        return json({ ok: true });
      }
      const urlZip = `https://github.com/${repo}/archive/${sha}.zip`;
      const snap = await setBaseSnapshot(env, { sha, url: urlZip, note: "manual setsha" });
      await sendMessage(env, chatId, `✅ Встановив базовий снепшот:\n• sha: ${snap.sha}\n• url: ${snap.url}`);
      await logReply(env, chatId);
      return json({ ok: true });
    }
  }

  // Якщо раніше ввімкнули режим очікування Drive-URL — перехоплюємо перше ж довільне повідомлення як URL
  const awaiting = await env.STATE_KV.get(`snapshot:await_url:${chatId}`);
  if (awaiting) {
    await env.STATE_KV.delete(`snapshot:await_url:${chatId}`);
    const maybeUrl = text;
    // Мінімальна валідація: має містити "drive.google.com"
    if (!/drive\.google\.com/i.test(maybeUrl)) {
      await sendMessage(env, chatId, "❌ Це не схоже на публічний лінк Google Drive. Спробуй ще раз `/snapshot setdrive`.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    const snap = await setBaseSnapshot(env, { sha: "", url: maybeUrl, note: "google drive base" });
    await sendMessage(env, chatId, `✅ Встановив базовий снепшот із Drive:\n• url: ${snap.url}`);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ---- /log on|off|status ----
  if (text.startsWith("/log")) {
    const sub = (text.split(" ")[1] || "status").toLowerCase();
    const owner = await isOwner(env, fromId);

    if (!owner && sub !== "status") {
      await sendMessage(env, chatId, "🔒 Керувати автологуванням може лише власник. Використай `/log status` або `/id`.");
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "on") {
      const ok = await setAutolog(env, true);
      const now = await getAutolog(env);
      await sendMessage(env, chatId, ok && now ? "🟢 Автологування УВІМКНЕНО. Пиши завдання з префіксом `+`." : "⚠️ Не вдалося увімкнути автологування (KV недоступне?).");
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "off") {
      const ok = await setAutolog(env, false);
      const now = await getAutolog(env);
      await sendMessage(env, chatId, ok && !now ? "⚪️ Автологування вимкнено." : "⚠️ Не вдалося вимкнути автологування (KV недоступне?).");
      await logReply(env, chatId);
      return json({ ok: true });
    }

    const enabled = await getAutolog(env);
    await sendMessage(env, chatId, `ℹ️ Автологування: ${enabled ? "УВІМКНЕНО" : "вимкнено"}.`);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ---- /todo, /todo clear, /done N ----
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
    await sendMessage(env, chatId, ok ? `✅ Готово: ${removed.text}\n\n${formatTodos(list)}` : "❌ Не той номер.");
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ---- автологування: + задача ----
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

  // /ping /help
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
        "/todo — показати список | /done N | /todo clear",
        "/snapshot — показати базовий снепшот",
        "/snapshot setdrive — встановити Drive-архів як базу",
        "/snapshot setsha owner/repo <sha> — встановити git-архів як базу",
      ].join("\n")
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  return json({ ok: true });
}
