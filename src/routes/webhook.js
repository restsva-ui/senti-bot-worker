import { json, sendMessage, logReply, isOwner, getAutolog, setAutolog } from "../lib/utils.js";
import { loadTodos, saveTodos, addTodo, removeTodoByIndex, formatTodos } from "../lib/todo.js";
import { syncOnce } from "../lib/checklist-manager.js";

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

  // /sync — ручний запуск нормалізації (owner)
  if (text === "/sync") {
    if (!(await isOwner(env, fromId))) {
      await sendMessage(env, chatId, "🔒 Лише власник.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    const { changed, addedRules, count } = await syncOnce(env, chatId);
    const parts = [
      "🔁 Sync виконано.",
      `• елементів: ${count}`,
      `• зміни: ${changed ? "так" : "ні"}`
    ];
    if (addedRules.length) parts.push("• додано правила:\n" + addedRules.map((r) => `  - ${r}`).join("\n"));
    await sendMessage(env, chatId, parts.join("\n"));
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // /log on|off|status
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
    // подієвий sync у фоні
    ctx.waitUntil(syncOnce(env, chatId));
    return json({ ok: true });
  }

  if (/^\/done\s+\d+$/i.test(text)) {
    const n = parseInt(text.split(/\s+/)[1], 10);
    const { ok, removed, list } = await removeTodoByIndex(env, chatId, n);
    await sendMessage(env, chatId, ok ? `✅ Готово: ${removed.text}\n\n${formatTodos(list)}` : "❌ Не той номер.");
    await logReply(env, chatId);
    // подієвий sync у фоні
    ctx.waitUntil(syncOnce(env, chatId));
    return json({ ok: true });
  }

  // автологування: + задача
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
        // подієвий sync у фоні
        ctx.waitUntil(syncOnce(env, chatId));
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
        "/ping, /id, /sync",
        "/log status | /log on | /log off",
        "/todo — показати список",
        "/done N — завершити пункт №N",
        "/todo clear — очистити список",
        "",
        "Коли увімкнено автологування — пиши `+ завдання`, і я додам у чек-лист.",
      ].join("\n")
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  return json({ ok: true });
}