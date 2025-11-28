import { TG } from "../lib/tg.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { getUserTokens } from "../lib/userDrive.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { think } from "../lib/brain.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json } from "../utils/http.js";
import { getRecentInsights } from "../lib/kvLearnQueue.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { replyCurrentDate, replyCurrentTime } from "../apis/time.js";

// — Додаємо підтримку мультимовності для привітання та автодетекту
function pickLang(msg, text = "") {
  // 1. Пробуємо по тексту (якщо юзер одразу нею пише)
  const lang = pickReplyLanguage(msg, text);
  // 2. Якщо в профілі є мова — беремо її (Telegram language_code)
  if (!lang || lang === "uk") {
    const code = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
    if (["uk", "en", "ru", "de", "fr"].includes(code)) return code;
  }
  // 3. Default — українська
  return lang || "uk";
}

// — Головний webhook handler
export default async function webhook(req, env, url) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  // Безпеки: перевіряємо секрет (якщо потрібен)
  if (env.TG_WEBHOOK_SECRET) {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (sec !== env.TG_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
  }

  const msg = body.message || body.edited_message || body.callback_query?.message;
  const userText = msg?.text || body.message?.text || "";

  // Мультимовна логіка: беремо мову юзера або autodetect
  const lang = pickLang(msg, userText);

  // Проста обробка команд/привітань
  if (userText === "/start" || /прив/i.test(userText) || /hello|hi|bonjour|salut|guten/i.test(userText)) {
    await TG.sendMessage(
      msg.chat.id,
      t(lang, "hello_name", msg.from?.first_name || "Senti") + "\n" + t(lang, "how_help"),
      { reply_markup: { keyboard: [[t(lang, "senti_tip")]], resize_keyboard: true } },
      env
    );
    return json({ ok: true });
  }

  // Далі — обробка запитів (моделі, brain, енергія, date, time)
  // ...
  // Обробка швидких команд (дата/час)
  if (/дата|date/i.test(userText)) {
    await TG.sendMessage(msg.chat.id, await replyCurrentDate(lang), {}, env);
    return json({ ok: true });
  }
  if (/час|время|time/i.test(userText)) {
    await TG.sendMessage(msg.chat.id, await replyCurrentTime(lang), {}, env);
    return json({ ok: true });
  }

  // Приклад роботи із Brain — можна розширювати:
  if (/інсайт|insight/i.test(userText)) {
    const rec = await getRecentInsights(env, { max: 1 });
    if (rec?.length) {
      await TG.sendMessage(msg.chat.id, rec[0], {}, env);
    } else {
      await TG.sendMessage(msg.chat.id, t(lang, "default_reply"), {}, env);
    }
    return json({ ok: true });
  }

  // Всі інші — коротка відповідь (модель/brain)
  try {
    const dialogHint = buildDialogHint(msg, userText, lang);
    const result = await askAnyModel(userText, { env, lang, dialogHint, chat_id: msg.chat.id });
    // Записуємо відповідь у пам'ять, якщо треба
    await pushTurn(msg.chat.id, { user: userText, bot: result });
    await TG.sendMessage(msg.chat.id, result, {}, env);
    return json({ ok: true });
  } catch (e) {
    await TG.sendMessage(msg.chat.id, t(lang, "default_reply"), {}, env);
    return json({ ok: false, error: String(e) });
  }
}
