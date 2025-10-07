// Адмін-панель для Senti
import { drivePing, driveList, driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";

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

export default async function adminHandler({ text, chatId, fromId }, env) {
  // доступ тільки для власника
  if (!isOwner(env, fromId)) {
    await sendMessage(env, chatId, "🔒 Доступ лише для власника.");
    return;
  }

  // без підкоманд — показуємо меню
  if (text === "/admin" || text === "/admin help") {
    await sendMessage(
      env,
      chatId,
      [
        "*Senti Admin*",
        "• `/admin drive ping` — перевірка Drive",
        "• `/admin drive list [N]` — останні N файлів у папці",
        "• `/admin backup url <URL> [name]` — зберегти файл/архів із URL",
        "• `/admin checklist add <текст>` — додати рядок у senti_checklist.md",
      ].join("\n")
    );
    return;
  }

  // ---- DRIVE
  if (text.startsWith("/admin drive")) {
    const parts = text.split(/\s+/);
    const sub = parts[2] || "help";

    if (sub === "ping") {
      try {
        await drivePing(env);
        await sendMessage(env, chatId, "🟢 Drive OK (папка доступна).");
      } catch (e) {
        await sendMessage(env, chatId, "❌ Drive помилка: " + asJson({ error: String(e?.message || e) }));
      }
      return;
    }

    if (sub === "list") {
      const n = parseInt(parts[3] ?? "10", 10);
      try {
        const files = await driveList(env, Number.isFinite(n) ? n : 10);
        await sendMessage(env, chatId, asJson({ ok: true, files }));
      } catch (e) {
        await sendMessage(env, chatId, "❌ list помилка: " + asJson({ error: String(e?.message || e) }));
      }
      return;
    }

    await sendMessage(env, chatId, "ℹ️ Використання: `/admin drive ping` або `/admin drive list [N]`");
    return;
  }

  // ---- BACKUP
  if (text.startsWith("/admin backup")) {
    const m = text.match(/^\/admin\s+backup\s+url\s+(\S+)(?:\s+(.+))?$/i);
    if (!m) {
      await sendMessage(env, chatId, "ℹ️ Використання: `/admin backup url <URL> [name]`");
      return;
    }
    const url = m[1];
    const name = (m[2] || "").trim();
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `🗜️ Архів/файл збережено: *${saved.name}*\n🔗 ${saved.link}`);
      await driveAppendLog(env, "senti_checklist.md", `backup saved: ${saved.name} (${saved.link})`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ backup помилка: " + asJson({ error: String(e?.message || e) }));
    }
    return;
  }

  // ---- CHECKLIST
  if (text.startsWith("/admin checklist")) {
    const m = text.match(/^\/admin\s+checklist\s+add\s+([\s\S]+)$/i);
    if (!m) {
      await sendMessage(env, chatId, "ℹ️ Використання: `/admin checklist add <текст>`");
      return;
    }
    const line = m[1].trim();
    try {
      const res = await driveAppendLog(env, "senti_checklist.md", line);
      await sendMessage(env, chatId, `✅ Записано у чеклист.\n${asJson({ result: res })}`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ checklist помилка: " + asJson({ error: String(e?.message || e) }));
    }
    return;
  }

  // якщо команда невідома
  await sendMessage(env, chatId, "❓ Невідома адмін-команда. Спробуй `/admin`.");
}