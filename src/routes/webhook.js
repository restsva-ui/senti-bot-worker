import { json, badRequest } from "../lib/resp.js";
import { verifyWebhookSecret } from "../lib/verify.js";
import { sendMessage } from "../lib/telegram.js";
import { seenUpdate } from "../lib/dedup.js";
import { rememberUserMessage, rememberBotMessage, getShortContext, resetMemory } from "../lib/memory.js";
import { rateLimit, allowWarn } from "../lib/ratelimit.js";
import { logReply, getStatus } from "../lib/journal.js";

export async function handleWebhook(request, env) {
  // 1) Перевіряємо секрет (header або ?secret)
  if (!verifyWebhookSecret(request, env)) {
    return json({ ok: true, ignored: true, reason: "bad secret" });
  }

  // 2) Парсимо апдейт
  let update;
  try {
    update = await request.json();
  } catch {
    return badRequest("invalid json");
  }

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const text = (msg?.text || msg?.caption || "").trim();
  const updateId = update.update_id;

  // 3) Антидубль
  if (await seenUpdate(env, chatId, updateId)) {
    return json({ ok: true, duplicate: true });
  }

  // 4) Rate-limit (1/2с, burst=3)
  if (chatId) {
    const rl = await rateLimit(env, chatId, { windowMs: 2000, burst: 3 });
    if (!rl.allowed) {
      if (await allowWarn(env, chatId, 10)) {
        const msgRL = `⏳ Повільніше, будь ласка. Спробуй ще раз через ~${Math.ceil(rl.retryAfterMs / 1000)}с.`;
        await sendMessage(env, chatId, msgRL).catch(() => {});
        await rememberBotMessage(env, chatId, msgRL);
        await logReply(env, chatId);
      }
      return json({ ok: true, limited: true, retryAfterMs: rl.retryAfterMs });
    }
  }

  // 5) Команди
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

  // 6) Звичайне повідомлення: пам'ять → відповідь → журнал
  if (chatId) {
    await rememberUserMessage(env, chatId, text);
    const ctx = await getShortContext(env, chatId, 4);
    const hint = ctx.slice(0, -1).length
      ? `\n🧠 У контексті збережено ${ctx.length} останніх реплік.`
      : "";
    const reply = `👋 Привіт! Ти написав: ${text || "(порожньо)"}${hint}\n\n/help → /ping /mem /reset /status`;
    await sendMessage(env, chatId, reply).catch(() => {});
    await rememberBotMessage(env, chatId, reply);
    await logReply(env, chatId);
  }

  return json({ ok: true });
}