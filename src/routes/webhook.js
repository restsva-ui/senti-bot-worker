import { json, badRequest } from "../lib/resp.js";
import { verifyWebhookSecret } from "../lib/verify.js";
import { sendMessage } from "../lib/telegram.js";
import { seenUpdate } from "../lib/dedup.js";
import { rememberUserMessage, rememberBotMessage, getShortContext, resetMemory } from "../lib/memory.js";

export async function handleWebhook(request, env) {
  // 1) Перевіряємо секрет (приймаємо header і ?secret)
  if (!verifyWebhookSecret(request, env)) {
    // Відповідаємо 200, щоб Telegram не ретраїв безкінечно
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
  const text = msg?.text || msg?.caption || "";
  const updateId = update.update_id;

  // 3) Антидубль
  if (await seenUpdate(env, chatId, updateId)) {
    return json({ ok: true, duplicate: true });
  }

  // 4) Команди
  if (chatId && typeof text === "string") {
    const t = text.trim();

    if (t === "/ping") {
      const reply = "🏓 pong";
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      return json({ ok: true });
    }

    if (t === "/mem") {
      const ctx = await getShortContext(env, chatId, 10);
      const lines = ctx.map(m => `${m.role === "user" ? "👤" : "🤖"} ${m.text}`).join("\n") || "порожньо";
      const reply = `🧠 Пам'ять (останні):\n${lines}`;
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      return json({ ok: true });
    }

    if (t === "/reset") {
      await resetMemory(env, chatId);
      const reply = "♻️ Пам'ять очищено.";
      await sendMessage(env, chatId, reply).catch(() => {});
      await rememberBotMessage(env, chatId, reply);
      return json({ ok: true });
    }
  }

  // 5) Звичайне повідомлення: запам'ятовуємо → відповідаємо echo + довідка
  if (chatId) {
    await rememberUserMessage(env, chatId, text);
    const ctx = await getShortContext(env, chatId, 4);
    const hint = ctx.slice(0, -1).length
      ? `\n🧠 У контексті збережено ${ctx.length} останніх реплік.`
      : "";
    const reply = `👋 Привіт! Ти написав: ${text || "(порожньо)"}${hint}\n\n/help → /ping /mem /reset`;
    await sendMessage(env, chatId, reply).catch(() => {});
    await rememberBotMessage(env, chatId, reply);
  }

  return json({ ok: true });
}