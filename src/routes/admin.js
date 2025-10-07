// Адмін-панель Senti: компактне меню + команди + 2-крокові дії з ForceReply
import { drivePing, driveList, driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";

const KB = {
  main: {
    inline_keyboard: [[
      { text: "Drive ✅", callback_data: "ADM:DRIVE_PING" },
      { text: "List 10 📄", callback_data: "ADM:DRIVE_LIST:10" },
    ],[
      { text: "Backup URL ⬆️", callback_data: "ADM:BACKUP_URL" },
      { text: "Checklist ➕", callback_data: "ADM:CHECKLIST_ADD" },
    ]],
  },
};

const PENDING_KEY = (chatId) => `admin:pending:${chatId}`; // зберігаємо наступну очікувану дію

function asJson(x) {
  return "```json\n" + JSON.stringify(x, null, 2) + "\n```";
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
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {}
}

async function answerCallback(env, cbId, text = "", showAlert = false) {
  if (!cbId) return;
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  const body = { callback_query_id: cbId, text, show_alert: showAlert };
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {}
}

function isOwner(env, fromId) {
  try {
    const raw = String(env.OWNER_ID ?? "").trim();
    if (!raw) return false;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return list.includes(String(fromId).trim());
  } catch {
    return false;
  }
}

// показ довідки + меню
async function showAdminHome(env, chatId) {
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
    { reply_markup: KB.main }
  );
}

// обробка callbackів меню
async function handleCallback(env, chatId, fromId, cbId, data) {
  if (!isOwner(env, fromId)) {
    await answerCallback(env, cbId, "Доступ лише для власника", true);
    return;
  }

  const parts = data.split(":"); // "ADM:DRIVE_LIST:10"
  const tag = parts[1];

  if (tag === "DRIVE_PING") {
    try {
      await drivePing(env);
      await answerCallback(env, cbId, "Drive OK");
      await sendMessage(env, chatId, "🟢 Drive OK");
    } catch (e) {
      await answerCallback(env, cbId, "Помилка Drive", true);
      await sendMessage(env, chatId, "❌ Drive: " + asJson({ error: String(e?.message || e) }));
    }
    return;
  }

  if (tag === "DRIVE_LIST") {
    const n = parseInt(parts[2] ?? "10", 10);
    try {
      const files = await driveList(env, Number.isFinite(n) ? n : 10);
      await answerCallback(env, cbId);
      await sendMessage(env, chatId, asJson({ ok: true, files }));
    } catch (e) {
      await answerCallback(env, cbId, "Помилка list", true);
      await sendMessage(env, chatId, "❌ list: " + asJson({ error: String(e?.message || e) }));
    }
    return;
  }

  if (tag === "BACKUP_URL") {
    // ставимо очікування наступного повідомлення з URL [name]
    await env.STATE_KV.put(PENDING_KEY(chatId), "BACKUP_URL", { expirationTtl: 600 });
    await answerCallback(env, cbId);
    await sendMessage(
      env,
      chatId,
      "Відповідай на це повідомлення текстом: `URL [name]`",
      { reply_markup: { force_reply: true } }
    );
    return;
  }

  if (tag === "CHECKLIST_ADD") {
    await env.STATE_KV.put(PENDING_KEY(chatId), "CHECKLIST_ADD", { expirationTtl: 600 });
    await answerCallback(env, cbId);
    await sendMessage(
      env,
      chatId,
      "Відповідай рядком, який додати в `senti_checklist.md`",
      { reply_markup: { force_reply: true } }
    );
    return;
  }

  await answerCallback(env, cbId);
}

// обробка текстових /admin команд (залишив сумісність)
async function handleAdminText(env, chatId, fromId, text) {
  if (!isOwner(env, fromId)) {
    await sendMessage(env, chatId, "🔒 Доступ лише для власника.");
    return;
  }

  if (text === "/admin" || text === "/admin help") {
    await showAdminHome(env, chatId);
    return;
  }

  if (text.startsWith("/admin drive")) {
    const parts = text.split(/\s+/);
    const sub = parts[2] || "help";

    if (sub === "ping") {
      try {
        await drivePing(env);
        await sendMessage(env, chatId, "🟢 Drive OK (папка доступна).");
      } catch (e) {
        await sendMessage(env, chatId, "❌ Drive: " + asJson({ error: String(e?.message || e) }));
      }
      return;
    }

    if (sub === "list") {
      const n = parseInt(parts[3] ?? "10", 10);
      try {
        const files = await driveList(env, Number.isFinite(n) ? n : 10);
        await sendMessage(env, chatId, asJson({ ok: true, files }));
      } catch (e) {
        await sendMessage(env, chatId, "❌ list: " + asJson({ error: String(e?.message || e) }));
      }
      return;
    }

    await sendMessage(env, chatId, "ℹ️ `/admin drive ping` або `/admin drive list [N]`");
    return;
  }

  if (text.startsWith("/admin backup")) {
    const m = text.match(/^\/admin\s+backup\s+url\s+(\S+)(?:\s+(.+))?$/i);
    if (!m) {
      await sendMessage(env, chatId, "ℹ️ `/admin backup url <URL> [name]`");
      return;
    }
    const url = m[1];
    const name = (m[2] || "").trim();
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `🗜️ Збережено: *${saved.name}*\n🔗 ${saved.link}`);
      await driveAppendLog(env, "senti_checklist.md", `backup saved: ${saved.name} (${saved.link})`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ backup: " + asJson({ error: String(e?.message || e) }));
    }
    return;
  }

  if (text.startsWith("/admin checklist")) {
    const m = text.match(/^\/admin\s+checklist\s+add\s+([\s\S]+)$/i);
    if (!m) {
      await sendMessage(env, chatId, "ℹ️ `/admin checklist add <текст>`");
      return;
    }
    const line = m[1].trim();
    try {
      const res = await driveAppendLog(env, "senti_checklist.md", line);
      await sendMessage(env, chatId, `✅ Записано у чеклист.\n${asJson({ result: res })}`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ checklist: " + asJson({ error: String(e?.message || e) }));
    }
    return;
  }

  // якщо щось інше — показати меню
  await showAdminHome(env, chatId);
}

// публічний вхід
export default async function adminEntry(ctx, env) {
  const { chatId, fromId, text, cbId, cbData, isCallback, isText } = ctx;

  if (isCallback && cbData?.startsWith("ADM:")) {
    await handleCallback(env, chatId, fromId, cbId, cbData);
    return;
  }

  // якщо очікуємо другу фазу (ForceReply)
  const pending = await env.STATE_KV.get(PENDING_KEY(chatId));
  if (isText && pending) {
    if (!isOwner(env, fromId)) {
      await sendMessage(env, chatId, "🔒 Доступ лише для власника.");
      await env.STATE_KV.delete(PENDING_KEY(chatId));
      return;
    }

    if (pending === "BACKUP_URL") {
      // очікується "URL [name]"
      const m = text.match(/^(\S+)(?:\s+(.+))?$/);
      if (!m) {
        await sendMessage(env, chatId, "Очікую формат: `URL [name]`");
      } else {
        const url = m[1];
        const name = (m[2] || "").trim();
        try {
          const saved = await driveSaveFromUrl(env, url, name);
          await sendMessage(env, chatId, `🗜️ Збережено: *${saved.name}*\n🔗 ${saved.link}`);
          await driveAppendLog(env, "senti_checklist.md", `backup saved: ${saved.name} (${saved.link})`);
        } catch (e) {
          await sendMessage(env, chatId, "❌ backup: " + asJson({ error: String(e?.message || e) }));
        }
      }
      await env.STATE_KV.delete(PENDING_KEY(chatId));
      return;
    }

    if (pending === "CHECKLIST_ADD") {
      const line = text.trim();
      if (!line) {
        await sendMessage(env, chatId, "Порожній рядок. Спробуй ще раз.");
      } else {
        try {
          const res = await driveAppendLog(env, "senti_checklist.md", line);
          await sendMessage(env, chatId, `✅ Додано у чеклист.\n${asJson({ result: res })}`);
        } catch (e) {
          await sendMessage(env, chatId, "❌ checklist: " + asJson({ error: String(e?.message || e) }));
        }
      }
      await env.STATE_KV.delete(PENDING_KEY(chatId));
      return;
    }
  }

  // за замовчуванням — /admin help
  if (isText && (text === "/admin" || text.startsWith("/admin "))) {
    await handleAdminText(env, chatId, fromId, text);
    return;
  }

  // коли прилетів виклик без команд — просто покажемо меню для власника
  if (isText && isOwner(env, fromId) && text === "/menu") {
    await showAdminHome(env, chatId);
  }
}