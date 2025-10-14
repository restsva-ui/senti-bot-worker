// [6/7] src/routes/webhook.js
import { TG } from "../lib/tg.js";
import { parseAiCommand, BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_CHECK, ADMIN, mainKeyboard } from "./webhook/utils.js";
import { handleIncomingMedia } from "./webhook/media.js";
import { handleAiSlash, handlePlainText } from "./webhook/ai.js";
import { handleStart, handleDiag, handleDriveOn, handleSentiMode, handleChecklistLink, handleAdminMenu, getDriveMode } from "./webhook/commands.js";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

export async function handleTelegramWebhook(req, env) {
  // повторна перевірка на випадок прямого виклику
  if (req.method !== "POST") return json({ ok: true, note: "webhook alive (GET)" });

  const sec = req.headers.get("x-telegram-bot-api-secret-token");
  if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;

  const textRaw =
    update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
  const text = (textRaw || "").trim();
  if (!msg) return json({ ok: true });

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const isAdmin = ADMIN(env, userId);

  // 1) /start
  if (text === "/start") {
    await handleStart(TG, env, chatId, userId);
    return json({ ok: true });
  }

  // 2) /diag (адмін)
  if (text === "/diag" && isAdmin) {
    await handleDiag(TG, env, chatId, String(env.MODEL_ORDER || "").trim());
    return json({ ok: true });
  }

  // 3) /ai ...
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await handleAiSlash(TG, env, chatId, userId, aiArg);
    return json({ ok: true });
  }

  // 4) кнопки
  if (text === BTN_DRIVE) {
    await handleDriveOn(TG, env, chatId, userId);
    return json({ ok: true });
  }
  if (text === BTN_SENTI) {
    await handleSentiMode(TG, env, chatId, userId);
    return json({ ok: true });
  }
  if (text === BTN_CHECK && isAdmin) {
    await handleChecklistLink(TG, env, chatId);
    return json({ ok: true });
  }
  if ((text === BTN_ADMIN || text === "/admin") && isAdmin) {
    await handleAdminMenu(TG, env, chatId);
    return json({ ok: true });
  }

  // 5) режим диска -> медіа
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, TG, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await TG.text(chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // 6) звичайний текст
  if (text && !text.startsWith("/")) {
    await handlePlainText(TG, env, chatId, userId, text);
    return json({ ok: true });
  }

  // 7) дефолт
  await TG.text(chatId, "Чіназес 👋", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}