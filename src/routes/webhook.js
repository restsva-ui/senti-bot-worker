// src/routes/webhook.js
// Orchestrator: приймає апдейти Telegram і делегує в модулі.

import { json, sendMessage } from "../telegram/helpers.js";
import { mainKeyboard, ADMIN } from "../telegram/ui.js";
import { getUserLang, tr } from "../lib/i18n.js";
import { parseAiCommand } from "../telegram/parsers.js";
import { buildSystemHint } from "../telegram/systemHint.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { think } from "../lib/brain.js";
import { getDriveMode, setDriveMode } from "../telegram/state.js";
import { handleIncomingMedia } from "../telegram/media.js";
import { handleFastPaths } from "../telegram/fastpaths.js";
import { detectIntent } from "../lib/nlu.js";
import { runIntent } from "../lib/intentRouter.js";
import { pushDialog } from "../telegram/dialog.js";

const isBlank = (s) => !s || !String(s).trim();

export async function handleTelegramWebhook(req, env) {
  // webhook auth
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
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

  // мова користувача
  const lang = await getUserLang(env, userId, msg.from?.language_code, text);

  const safe = async (fn) => {
    try { await fn(); } catch (e) { await sendMessage(env, chatId, tr(lang, "generic_error", String(e))); }
  };

  // /start — тільки дружнє вітання + клавіатура
  if (text === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, tr(lang, "hello"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // /tone
  if (text.startsWith("/tone")) {
    const { handleToneCommand } = await import("../telegram/toneCmd.js");
    await safe(() => handleToneCommand({ env, chatId, lang, text }));
    return json({ ok: true });
  }

  // /diag — only admin
  if (text === "/diag" && isAdmin) {
    await safe(async () => {
      const hasGemini   = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
      const hasCF       = !!(env.CF_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
      const hasOR       = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_API_BASE_URL;
      const hasFreeKey  = !!env.FREE_API_KEY;
      const mo = String(env.MODEL_ORDER || "").trim();

      const lines = [
        "🧪 Діагностика AI",
        `MODEL_ORDER: ${mo || "(порожньо)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
      ];

      const entries = mo ? mo.split(",").map(s => s.trim()).filter(Boolean) : [];
      if (entries.length) {
        const health = await getAiHealthSummary(env, entries);
        lines.push("\n— Health:");
        for (const h of health) {
          const light = h.cool ? "🟥" : (h.slow ? "🟨" : "🟩");
          const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
          lines.push(`${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${h.failStreak || 0}`);
        }
      }
      await sendMessage(env, chatId, lines.join("\n"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // /ai
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) { await sendMessage(env, chatId, tr(lang, "ai_usage")); return; }

      const info = await getEnergy(env, userId);
      const { costText, low, energy } = info;
      if (energy < costText) {
        const links = await (await import("../telegram/ui.js")).energyLinks(env, userId);
        await sendMessage(env, chatId, tr(lang, "energy_not_enough", costText, links));
        return;
      }
      const spent = await spendEnergy(env, userId, costText, "text");

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let reply = "";
      try {
        if (modelOrder) {
          const merged = `${systemHint}\n\nUser: ${q}`;
          reply = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
        } else {
          reply = await think(env, q, systemHint);
        }
      } catch (e) {
        reply = `🧠 AI error: ${String(e?.message || e)}`;
      }

      if (isBlank(reply)) reply = tr(lang, "ai_usage");

      await pushDialog(env, userId, "user", q);
      await pushDialog(env, userId, "assistant", reply);

      if (spent.energy <= low) {
        const links = await (await import("../telegram/ui.js")).energyLinks(env, userId);
        reply += `\n\n${tr(lang, "energy_low_hint", spent.energy, links.energy)}`;
      }
      await sendMessage(env, chatId, reply);
    });
    return json({ ok: true });
  }

  // Drive — тільки кнопка, без текстів
  if (text === (await import("../telegram/ui.js")).then(m => m.BTN_DRIVE ? m.BTN_DRIVE : "📁 Drive")) {
    const { handleDriveButton } = await import("../telegram/driveButton.js");
    await safe(() => handleDriveButton({ env, chatId, userId, lang }));
    return json({ ok: true });
  }

  // Senti — тихе вимкнення режиму диска
  if (text === (await import("../telegram/ui.js")).then(m => m.BTN_SENTI ? m.BTN_SENTI : "🧠 Senti")) {
    await safe(async () => { await setDriveMode(env, userId, false); });
    return json({ ok: true });
  }

  // Admin — інлайн-меню з посиланнями (і повертаємо клавіатуру)
  if ((text === (await import("../telegram/ui.js")).then(m => m.BTN_ADMIN ? m.BTN_ADMIN : "🔧 Admin") || text === "/admin") && isAdmin) {
    const { sendAdminMenu } = await import("../telegram/adminMenu.js");
    await safe(async () => {
      await sendAdminMenu({ env, chatId });
      await sendMessage(env, chatId, "\u2060", { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // Drive mode: media
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, tr(lang, "generic_error", String(e)));
    return json({ ok: true });
  }

  // FAST-PATH (weather/news/rate/wiki/holidays)
  if (text && !text.startsWith("/")) {
    const handled = await handleFastPaths({ env, chatId, lang, text });
    if (handled) return json({ ok: true, fast: handled });
  }

  // INTENT-FIRST
  if (text && !text.startsWith("/")) {
    const intent = detectIntent(text, lang);
    if (intent.type !== "none") {
      try {
        const out = await runIntent(intent, env); // { text, mode }
        if (out && out.text) {
          const extra = out.mode === "HTML" ? { parse_mode: "HTML", disable_web_page_preview: true } : {};
          await sendMessage(env, chatId, out.text, extra);
          return json({ ok: true, intent: intent.type });
        }
      } catch {
        // fallthrough to LLM
      }
    }
  }

  // Regular text -> AI (fallback)
  if (text && !text.startsWith("/")) {
    try {
      const info = await getEnergy(env, userId);
      const { costText, low, energy } = info;
      if (energy < costText) {
        const links = await (await import("../telegram/ui.js")).energyLinks(env, userId);
        await sendMessage(env, chatId, tr(lang, "energy_not_enough", costText, links));
        return json({ ok: true });
      }
      const spent = await spendEnergy(env, userId, costText, "text");

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let out = "";

      if (modelOrder) {
        const merged = `${systemHint}\n\nUser: ${text}`;
        out = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
      } else {
        out = await think(env, text, systemHint);
      }

      if (isBlank(out)) out = tr(lang, "ai_usage");

      await pushDialog(env, userId, "user", text);
      await pushDialog(env, userId, "assistant", out);

      if (spent.energy <= low) {
        const links = await (await import("../telegram/ui.js")).energyLinks(env, userId);
        out += `\n\n${tr(lang, "energy_low_hint", spent.energy, links.energy)}`;
      }
      await sendMessage(env, chatId, out);
      return json({ ok: true });
    } catch (e) {
      await sendMessage(env, chatId, tr(lang, "ai_usage"));
      return json({ ok: true });
    }
  }

  // default — коротке вітання + клавіатура
  await sendMessage(env, chatId, tr(lang, "hello"), { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}
