// src/routes/webhook.js
import { getState, setState, clearState } from "../lib/index.js";
import { ensureBotCommands, handleAdminCommand, wantAdmin } from "./admin.js";
import { drivePing, driveSaveFromUrl, driveAppendLog, driveListLatest } from "../lib/drive.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
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
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {}
}

// ── Основний обробник ────────────────────────────────────────────────────────
export default async function webhook(request, env, ctx) {
  let update;
  try { update = await request.json(); }
  catch { return json({ ok: false, error: "bad json" }, { status: 400 }); }

  const msg =
    update.message ||
    update.edited_message ||
    update.callback_query?.message ||
    null;

  const chatId = msg?.chat?.id;
  const fromId =
    update.message?.from?.id ??
    update.edited_message?.from?.id ??
    update.callback_query?.from?.id ??
    null;

  const text =
    (update.message?.text ??
      update.edited_message?.text ??
      update.callback_query?.data ??
      "").trim();

  if (!chatId) return json({ ok: true });

  // /start — реєструємо команди *для цього чату* і показуємо меню
  if (text === "/start") {
    await ensureBotCommands(env, chatId); // важливо: chat-scope + default
    const res = await handleAdminCommand(env, chatId, "/admin");
    if (res) {
      await sendMessage(
        env,
        chatId,
        res.text,
        res.keyboard ? { reply_markup: res.keyboard } : {}
      );
      return json({ ok: true });
    }
  }

  // Базові команди, щоб бот «не мовчав»
  if (text === "/ping") {
    await sendMessage(env, chatId, "pong 🟢");
    return json({ ok: true });
  }
  if (text === "/help") {
    await sendMessage(
      env,
      chatId,
      "Доступні команди:\n" +
        "/start — запустити бота\n" +
        "/menu — адмін-меню\n" +
        "/ping — перевірка зв'язку"
    );
    return json({ ok: true });
  }
  if (text === "/menu" || text === "/admin") {
    await ensureBotCommands(env, chatId);
    const res = await handleAdminCommand(env, chatId, "/admin");
    if (res) {
      await sendMessage(env, chatId, res.text, res.keyboard ? { reply_markup: res.keyboard } : {});
    }
    return json({ ok: true });
  }

  // Адмін-панель (кнопка/команда)
  if (wantAdmin(text)) {
    const res = await handleAdminCommand(env, chatId, text);
    if (res) {
      if (res.expect) await setState(env, chatId, res.expect);
      await sendMessage(
        env,
        chatId,
        res.text,
        res.keyboard ? { reply_markup: res.keyboard } : {}
      );
      return json({ ok: true });
    }
  }

  // Обробка очікуваних кроків (Checklist/Backup)
  const state = await getState(env, chatId);

  if (state?.mode === "append-checklist") {
    const line = text.replace(/\n/g, " ").trim();
    if (!line) {
      await sendMessage(env, chatId, "❗ Це не схоже на рядок. Спробуй ще раз.");
      return json({ ok: true });
    }
    try {
      const r = await driveAppendLog(env, "senti_checklist.md", line);
      await sendMessage(env, chatId, `✅ Додано в чеклист.\n🔗 ${r.webViewLink}`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ Не вдалося додати: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return json({ ok: true });
  }

  if (state?.mode === "backup-url") {
    const m = text.match(/^\s*(https?:\/\/\S+)(?:\s+(.+))?$/i);
    if (!m) {
      await sendMessage(env, chatId, "❗ Це не схоже на URL. Спробуй ще раз: `https://... [назва]`");
      return json({ ok: true });
    }
    const url = m[1];
    const name = (m[2] || "").trim();
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `📤 Залив у Drive: *${saved.name}*\n🔗 ${saved.link}`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ Не вдалося залити: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return json({ ok: true });
  }

  // Кнопки з меню (реальні дії)
  if (text.toLowerCase() === "drive ✅" || text === "/gdrive_ping_btn") {
    try { await drivePing(env); await sendMessage(env, chatId, "🟢 Drive доступний, папка знайдена."); }
    catch (e) { await sendMessage(env, chatId, "❌ Drive недоступний: " + String(e?.message || e)); }
    return json({ ok: true });
  }

  if (text.toLowerCase() === "list 10 🧾" || text === "list 10" || text === "/list10_btn") {
    try {
      const list = await driveListLatest(env, 10);
      if (!list?.length) { await sendMessage(env, chatId, "Список порожній."); return json({ ok: true }); }
      const lines = list.map((f, i) => {
        const dt = new Date(f.modifiedTime || Date.now());
        const time = dt.toISOString().replace("T", " ").replace("Z", "");
        return [`${i + 1}. *${f.name}*`, `🕓 ${time}`, f.webViewLink ? `🔗 ${f.webViewLink}` : ""]
          .filter(Boolean).join("\n");
      });
      await sendMessage(env, chatId, "Останні 10 файлів:\n\n" + lines.join("\n\n"));
    } catch (e) {
      await sendMessage(env, chatId, "Не вдалося отримати список: " + String(e?.message || e));
    }
    return json({ ok: true });
  }

  // === Google Drive команди для ручного вводу ===
  if (text === "/gdrive ping") {
    try { await drivePing(env); await sendMessage(env, chatId, "🟢 Drive доступний, папка знайдена."); }
    catch (e) { await sendMessage(env, chatId, "❌ Drive недоступний: " + String(e?.message || e)); }
    return json({ ok: true });
  }

  if (/^\/gdrive\s+save\s+/i.test(text)) {
    const parts = text.split(/\s+/);
    const url = parts[2];
    const name = parts.length > 3 ? parts.slice(3).join(" ").trim() : "";
    if (!url) {
      await sendMessage(env, chatId, "ℹ️ Використання: `/gdrive save <url> [назва.zip]`");
      return json({ ok: true });
    }
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await sendMessage(env, chatId, `📤 Залив у Drive: *${saved.name}*\n🔗 ${saved.link}`);
    } catch (e) {
      await sendMessage(env, chatId, "❌ Не вдалося залити: " + String(e?.message || e));
    }
    return json({ ok: true });
  }

  return json({ ok: true });
}