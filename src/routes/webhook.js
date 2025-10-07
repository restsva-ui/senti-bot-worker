// Легкий диспетчер + базові команди
import { ensureBotCommands, handleAdminCommand, wantAdmin } from "./admin.js";
import { getState, clearState } from "../lib/state.js";

// універсальна відповідь JSON
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: "Markdown", ...extra };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {}
}

const n = (t) =>
  (t || "")
    .replace(/[\uFE0F]/g, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export default async function webhook(request, env) {
  let update;
  try { update = await request.json(); } catch { return json({ ok: false, error: "bad json" }, { status: 400 }); }

  const msg = update.message || update.edited_message || update.callback_query?.message || null;
  const chatId = msg?.chat?.id;
  const text =
    update.message?.text ??
    update.edited_message?.text ??
    update.callback_query?.data ??
    "";
  if (!chatId) return json({ ok: true });

  const norm = n(text);

  // 1) Одноразово оновлюємо список команд (і прибираємо зайві)
  // робимо це на /start, /admin і /menu, а також якщо явно попросили
  if (["/start", "/admin", "/menu", "/refresh_cmds"].includes(norm)) {
    await ensureBotCommands(env);
  }

  // 2) Адмін-панель та її діалоги (стани)
  //    handleAdminCommand вміє:
  //    - показати панель
  //    - обробити кнопки Drive / List 10 / Backup URL / Checklist +
  //    - обробити очікування URL і рядка для чеклиста
  const state = await getState(env, chatId);
  const handled = await handleAdminCommand({ env, update, chatId, text, norm, state });
  if (handled) return json({ ok: true });

  // 3) Базові дрібні команди
  if (norm === "/ping") {
    await sendMessage(env, chatId, "🏓 Pong!");
    return json({ ok: true });
  }

  if (norm === "/help") {
    await sendMessage(
      env,
      chatId,
      [
        "*Команди:*",
        "/admin — адмін-панель (Drive/Backup/Checklist)",
        "/menu — те саме, що /admin",
        "/ping — перевірка",
        "",
        "Натисни */admin* щоб відкрити кнопки.",
      ].join("\n")
    );
    return json({ ok: true });
  }

  // 4) Якщо користувач випадково щось надіслав у середині діалогу — приберемо стан, щоб не зациклювалось
  if (state) await clearState(env, chatId);

  // не впізнали — мовчазний success
  return json({ ok: true });
}