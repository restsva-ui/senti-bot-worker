// src/routes/webhook.js

import { getUserTokens } from "../lib/userDrive.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { pushTurn } from "../lib/dialogMemory.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  parseAiCommand,
} from "../lib/tg.js";
import { buildSystemHint } from "../lib/systemHint.js";
import { handleIncomingMedia } from "../lib/media.js";
import { getPreferredName, rememberNameFromText } from "../lib/profile.js";
import { getAiHealthSummary } from "../lib/modelRouter.js";
import { aiRespond } from "../flows/aiRespond.js";

// ── MAIN ────────────────────────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET ||
      "";
    if (expected && sec !== expected) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();

  // Мова відповіді (з урахуванням профілю TG і контексту повідомлення)
  let lang = pickReplyLanguage(msg, textRaw);

  const safe = async (fn) => {
    try { await fn(); }
    catch { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} }
  };

  // /admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY);
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!(env.OPENROUTER_API_KEY);
      const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
      const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);
      const lines = [
        t(lang, "admin_header"),
        `MODEL_ORDER: ${mo || "(not set)"}`,
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
      const links = energyLinks(env, userId);
      const markup = {
        inline_keyboard: [
          [{ text: "Відкрити Checklist", url: links.checklist }],
          [{ text: "Керування енергією", url: links.energy }],
        ],
      };
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: markup });
    });
    return json({ ok: true });
  }

  // /ai
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) { await sendPlain(env, chatId, t(lang, "senti_tip")); return; }

      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return;
      }
      await spendEnergy(env, userId, need, "text");

      const systemHint = await buildSystemHint(env, chatId, userId);
      const name = await getPreferredName(env, msg);
      const expand = /\b(детальн|подроб|подробнее|more|details|expand|mehr|détails)\b/i.test(q);

      const { short, full } = await aiRespond(env, { text: q, lang, name, systemHint, expand });

      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", full);

      const after = (cur.energy - need);
      if (expand && full.length > short.length) {
        // розбиваємо великий текст на телеграм-френдлі шматки
        for (let i = 0; i < full.length; i += 3500) {
          await sendPlain(env, chatId, full.slice(i, i + 3500));
        }
      } else {
        await sendPlain(env, chatId, short);
      }
      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", after, links.energy));
      }
    });
    return json({ ok: true });
  }

  // Google Drive — лише кнопка (без тексту)
  if (textRaw === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      await setDriveMode(env, userId, true);
      const zeroWidth = "\u2063"; // невидимий символ
      if (!ut?.refresh_token) {
        const authUrl = `${env.__ABS__ || ""}/auth/start?u=${userId}`;
        await sendPlain(env, chatId, zeroWidth, {
          reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: authUrl }]] },
        });
        return;
      }
      await sendPlain(env, chatId, zeroWidth, {
        reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] },
      });
    });
    return json({ ok: true });
  }

  // Кнопка Senti → НЕ вітатися; просто вимкнути Drive-режим і показати клавіатуру
  if (textRaw === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    const zeroWidth = "\u2063";
    await sendPlain(env, chatId, zeroWidth, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // Медіа в режимі диска
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
  } catch (e) {
    await sendPlain(env, chatId, `❌ ${String(e)}`);
    return json({ ok: true });
  }

  // Звичайний текст → AI
  if (textRaw && !textRaw.startsWith("/")) {
    try {
      await rememberNameFromText(env, userId, textRaw);

      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return json({ ok: true });
      }
      await spendEnergy(env, userId, need, "text");

      const systemHint = await buildSystemHint(env, chatId, userId);
      const name = await getPreferredName(env, msg);
      const expand = /\b(детальн|подроб|подробнее|more|details|expand|mehr|détails)\b/i.test(textRaw);

      const { short, full } = await aiRespond(env, { text: textRaw, lang, name, systemHint, expand });

      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", full);

      const after = (cur.energy - need);
      if (expand && full.length > short.length) {
        for (let i = 0; i < full.length; i += 3500) {
          await sendPlain(env, chatId, full.slice(i, i + 3500));
        }
      } else {
        await sendPlain(env, chatId, short);
      }
      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", after, links.energy));
      }
      return json({ ok: true });
    } catch {
      await sendPlain(env, chatId, t(lang, "default_reply"));
      return json({ ok: true });
    }
  }

  // Дефолтне привітання
  const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
  const greetLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
  const name = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `${t(greetLang, "hello_name", name)} ${t(greetLang, "how_help")}`, {
    reply_markup: mainKeyboard(isAdmin),
  });
  return json({ ok: true });
}