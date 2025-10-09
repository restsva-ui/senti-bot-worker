// src/routes/admin.js
import { TG } from "../lib/tg.js";
import { drivePing, driveList, appendToChecklist, getAccessToken } from "../lib/drive.js";

export const adminRoutes = async (req, env, url) => {
  const p = url.pathname;

  // Меню-підказки мінімальні
  if (p === "/tg/install-commands-min") {
    await TG.setCommands(env.BOT_TOKEN, { type:"default" }, []);
    if (!env.TELEGRAM_ADMIN_ID) throw new Error("TELEGRAM_ADMIN_ID not set");
    await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, [
      { command: "admin", description: "Відкрити адмін-меню" },
    ]);
    return new Response(JSON.stringify({ ok:true, installed:"minimal" }), { headers:{ "content-type":"application/json" }});
  }
  if (p === "/tg/clear-commands") {
    await TG.setCommands(env.BOT_TOKEN, { type:"default" }, []);
    if (env.TELEGRAM_ADMIN_ID) {
      await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, []);
    }
    return new Response(JSON.stringify({ ok:true, cleared:true }), { headers:{ "content-type":"application/json" }});
  }

  // Швидкі перевірки диска
  if (p === "/gdrive/ping") {
    try {
      const token = await getAccessToken(env);
      const files = await driveList(env, token);
      return new Response(JSON.stringify({ ok:true, files: files.files || [] }), { headers:{ "content-type":"application/json" }});
    } catch (e) {
      return new Response(JSON.stringify({ ok:false, error:String(e) }), { status:500, headers:{ "content-type":"application/json" }});
    }
  }
  if (p === "/gdrive/checklist") {
    const token = await getAccessToken(env);
    const line = url.searchParams.get("line") || `tick ${new Date().toISOString()}`;
    await appendToChecklist(env, token, line);
    return new Response(JSON.stringify({ ok:true }), { headers:{ "content-type":"application/json" }});
  }

  // CI note
  if (p === "/ci/deploy-note") {
    const s = url.searchParams.get("s");
    if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ ok:false, error:"unauthorized" }), { status:401, headers:{ "content-type":"application/json" }});
    }
    const commit = url.searchParams.get("commit") || "";
    const actor  = url.searchParams.get("actor") || "";
    const depId  = url.searchParams.get("deploy") || env.DEPLOY_ID || "";
    const line = `[deploy] ${new Date().toISOString()} actor=${actor} commit=${commit} deploy=${depId}`;
    const token = await getAccessToken(env);
    await appendToChecklist(env, token, line);
    return new Response(JSON.stringify({ ok:true, line }), { headers:{ "content-type":"application/json" }});
  }

  return null;
};

export const handleAdminCommand = async ({ env, chatId, userId, text, msg, isAdmin, TG, getAccessToken, driveList, appendToChecklist, logDeploy, RAG }) => {
  if (!isAdmin) {
    await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN });
    return;
  }

  if (text === "/admin") {
    await TG.text(chatId,
`🛠 Адмін-меню

• /admin_ping — ping адмін-диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — ручний рефреш
• /admin_note_deploy — тестова деплой-нотатка
• /ask <запит> — питання до Senti (Gemini + RAG)
• (reply) /summarize — стиснути виділений текст/повідомлення`,
      { token: env.BOT_TOKEN }
    );
    return;
  }

  if (text.startsWith("/admin_ping")) {
    const r = await (await import("../lib/drive.js")).drivePing(env);
    await TG.text(chatId, `✅ Admin Drive OK. filesCount: ${r.filesCount}`, { token: env.BOT_TOKEN });
    return;
  }

  if (text.startsWith("/admin_list")) {
    const token = await getAccessToken(env);
    const files = await driveList(env, token);
    const arr = files.files || [];
    const msgOut = arr.length
      ? "Адмін диск:\n" + arr.map(f => `• ${f.name} (${f.id})`).join("\n")
      : "📁 Диск порожній.";
    await TG.text(chatId, msgOut, { token: env.BOT_TOKEN });
    try { await appendToChecklist(env, token, `admin_list OK ${new Date().toISOString()}`); } catch {}
    return;
  }

  if (text.startsWith("/admin_checklist")) {
    const line = text.replace("/admin_checklist","").trim() || `tick ${new Date().toISOString()}`;
    const token = await getAccessToken(env);
    await appendToChecklist(env, token, line);
    await TG.text(chatId, `✅ Додано: ${line}`, { token: env.BOT_TOKEN });
    return;
  }

  if (text.startsWith("/admin_setwebhook")) {
    const target = `https://${env.SERVICE_HOST}/webhook`;
    await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
    await TG.text(chatId, `✅ Вебхук → ${target}${env.TG_WEBHOOK_SECRET ? " (секрет застосовано)" : ""}`, { token: env.BOT_TOKEN });
    return;
  }

  if (text.startsWith("/admin_refreshcheck")) {
    try {
      const tok = await getAccessToken(env);
      if (tok) await TG.text(chatId, `✅ Refresh OK (отримано access_token).`, { token: env.BOT_TOKEN });
    } catch (e) {
      await TG.text(chatId, `❌ Refresh failed: ${String(e)}`, { token: env.BOT_TOKEN });
    }
    return;
  }

  if (text.startsWith("/admin_note_deploy")) {
    const line = await logDeploy(env, { source:"manual", actor:String(userId) });
    await TG.text(chatId, `📝 ${line}`, { token: env.BOT_TOKEN });
    return;
  }

  // “розум”
  if (text.startsWith("/ask")) {
    const { AI } = await import("../lib/ai.js");
    const q = text.replace("/ask","").trim() || "Поясни поточний стан проекту коротко.";
    let ctx = [];
    try { ctx = await RAG.search(env, q, 4); } catch(e){ console.log("RAG search err", e); }
    const system = "Ти технічний асистент Senti. Відповідай стисло, по суті. Якщо даєш кроки — нумеруй. Користуйся контекстом, але не вигадуй.";
    const ans = await AI.ask(env, { system, prompt: q, context: ctx });
    await TG.text(chatId, ans || "…", { token: env.BOT_TOKEN });
    return;
  }

  if (text.startsWith("/summarize")) {
    const { AI } = await import("../lib/ai.js");
    const src = msg.reply_to_message?.text || msg.reply_to_message?.caption || "";
    if(!src){
      await TG.text(chatId,"Відповідай /summarize на повідомлення/текст.",{token:env.BOT_TOKEN});
      return;
    }
    const system = "Стисни зміст до 5 пунктів із конкретикою. Не загальні фрази.";
    const ans = await AI.ask(env, { system, prompt: src });
    await TG.text(chatId, ans || "…", { token: env.BOT_TOKEN });
    return;
  }
};