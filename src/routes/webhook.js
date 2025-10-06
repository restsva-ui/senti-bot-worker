import { json, badRequest } from "../lib/resp.js";
import { verifyWebhookSecret } from "../lib/verify.js";
import { sendMessage } from "../lib/telegram.js";
import { seenUpdate } from "../lib/dedup.js";
import { rememberUserMessage, rememberBotMessage, getShortContext, resetMemory } from "../lib/memory.js";
import { rateLimit, allowWarn } from "../lib/ratelimit.js";
import { logReply, getStatus } from "../lib/journal.js";

import { getChecklist, addItem, markDone, removeItem, clearChecklist, toMarkdown } from "../lib/checklist.js";

function isOwner(env, fromId) {
  const owner = env.OWNER_ID ? String(env.OWNER_ID) : "";
  return owner && String(fromId) === owner;
}

export async function handleWebhook(request, env) {
  if (!verifyWebhookSecret(request, env)) {
    return json({ ok: true, ignored: true, reason: "bad secret" });
  }

  let update;
  try { update = await request.json(); } catch { return badRequest("invalid json"); }

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const fromId = msg?.from?.id;
  const text = (msg?.text || msg?.caption || "").trim();
  const updateId = update.update_id;

  if (await seenUpdate(env, chatId, updateId)) {
    return json({ ok: true, duplicate: true });
  }

  if (chatId) {
    const rl = await rateLimit(env, chatId, { windowMs: 2000, burst: 3 });
    if (!rl.allowed) {
      if (await allowWarn(env, chatId, 10)) {
        const msgRL = `⏳ Повільніше, будь ласка. Спробуй ще раз через ~${Math.ceil(rl.retryAfterMs / 1000)}с.`;
        await sendMessage(env, chatId, msgRL).catch(() => {});
        await rememberBotMessage(env, chatId, msgRL);
        await logReply(env, chatId);
      }
      return json({ ok: true, limited: true });
    }
  }

  // ====== Команди CheckList (/todo ...) ======
  if (chatId && text.startsWith("/todo")) {
    const args = text.split(" ").slice(1);
    const sub = (args[0] || "list").toLowerCase();

    // Лише власник (OWNER_ID) може змінювати; усі можуть читати.
    const canWrite = isOwner(env, fromId);

    if (sub === "list") {
      const md = toMarkdown(await getChecklist(env));
      await sendMessage(env, chatId, `🔖 Чек-лист:\n${md}`, { parse_mode: "Markdown" }).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (!canWrite) {
      const reply = "🔒 Зміни доступні лише власнику. Використай `/todo list` для перегляду.";
      await sendMessage(env, chatId, reply).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "add") {
      const textToAdd = args.slice(1).join(" ").trim();
      if (!textToAdd) {
        await sendMessage(env, chatId, "➕ `/todo add <текст>`").catch(() => {});
      } else {
        const it = await addItem(env, textToAdd, fromId);
        await sendMessage(env, chatId, `➕ Додано (${it.id}): ${it.text}`).catch(() => {});
      }
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "done" || sub === "undo") {
      const id = parseInt(args[1] || "0", 10);
      const ok = await markDone(env, id, sub === "done");
      await sendMessage(env, chatId, ok ? `✅ Оновлено (${id})` : `❓ Не знайдено (${id})`).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "rm") {
      const id = parseInt(args[1] || "0", 10);
      const ok = await removeItem(env, id);
      await sendMessage(env, chatId, ok ? `🗑️ Видалено (${id})` : `❓ Не знайдено (${id})`).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "clear") {
      await clearChecklist(env);
      await sendMessage(env, chatId, "♻️ Чек-лист очищено.").catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    // help
    await sendMessage(
      env,
      chatId,
      "Команди чек-листа:\n" +
      "/todo list\n" +
      "/todo add <текст>\n" +
      "/todo done <id> | /todo undo <id>\n" +
      "/todo rm <id> | /todo clear"
    ).catch(() => {});
    await logReply(env, chatId);
    return json({ ok: true });
  }
  // ====== Кінець блоку чек-листа ======

  // Інші команди
  if (chatId && text) {
    if (text === "/ping") {
      const reply = "🏓 pong";
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      await logReply(env, chatId);
      return json({ ok: true });
    }
    if (text === "/mem") {
      const ctx = await getShortContext(env, chatId, 10);
      const lines = ctx.map(m => `${m.role === "user" ? "👤" : "🤖"} ${m.text}`).join("\n") || "порожньо";
      const reply = `🧠 Пам'ять (останні):\n${lines}`;
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      await logReply(env, chatId);
      return json({ ok: true });
    }
    if (text === "/reset") {
      await resetMemory(env, chatId);
      const reply = "♻️ Пам'ять очищено.";
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      await logReply(env, chatId);
      return json({ ok: true });
    }
    if (text === "/status") {
      const st = await getStatus(env, chatId);
      const last = st.last_ts ? new Date(st.last_ts).toISOString() : "ніколи";
      const today = new Date().toISOString().slice(0, 10);
      const todayCnt = st.by_day?.[today] || 0;
      const reply = `📊 Статус: total=${st.total}, сьогодні=${todayCnt}, last=${last}`;
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      await logReply(env, chatId);
      return json({ ok: true });
    }
  }

  if (chatId) {
    await rememberUserMessage(env, chatId, text);
    const ctx = await getShortContext(env, chatId, 4);
    const hint = ctx.slice(0, -1).length
      ? `\n🧠 У контексті збережено ${ctx.length} останніх реплік.`
      : "";
    const reply = `👋 Привіт! Ти написав: ${text || "(порожньо)"}${hint}\n\n/help → /ping /mem /reset /status /todo`;
    await sendMessage(env, chatId, reply).catch(() => {});
    await rememberBotMessage(env, chatId, reply);
    await logReply(env, chatId);
  }

  return json({ ok: true });
}