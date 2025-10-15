// src/routes/webhook.js
// Telegram webhook з інтеграцією "мозку", Статутом, Self-Tune, Dialog Memory і режимом диска.
// Режим відповідей: спочатку стисло (1 SMS), детально — за інтенцією користувача.
// Емодзі підбираються за темою запиту. Без parse_mode (щоб уникнути MarkdownV2-помилок).

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";

// Енергія
import { getEnergy, spendEnergy } from "../lib/energy.js";

// Dialog Memory
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";

// Self-Tune
import { loadSelfTune } from "../lib/selfTune.js";

// Drive-Mode
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";

// ── Константи ────────────────────────────────────────────────────────────────
const CHUNK = 3500;            // безпечний розмір шматка під Telegram 4096
const SUMMARY_TARGET = 800;    // цілим ~1 SMS
const SUMMARY_MIN = 450;
const LAST_Q_KEY = (u) => `dialog:last:q:${u}`;
const LAST_MODE_KEY = (u) => `dialog:last:mode:${u}`; // "summary" | "expand"

// ── helpers ──────────────────────────────────────────────────────────────────
async function sendPlain(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const send = async (t) => {
    const body = {
      chat_id: chatId,
      text: t,
      disable_web_page_preview: true,
      ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {})
    };
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).catch(() => {});
  };

  if (!text) return;
  if (text.length <= CHUNK) { await send(text); return; }

  let rest = text;
  while (rest.length) {
    if (rest.length <= CHUNK) { await send(rest); break; }
    let cut = rest.lastIndexOf("\n", CHUNK);
    if (cut < CHUNK * 0.6) cut = rest.lastIndexOf(". ", CHUNK);
    if (cut < CHUNK * 0.5) cut = CHUNK;
    const part = rest.slice(0, cut).trim();
    rest = rest.slice(cut).trim();
    await send(part);
    extra = {}; // не дублюємо markup
  }
}

function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

function defaultAiReply() {
  return "Вибач, зараз не готовий відповісти чітко. Спробуй переформулювати або дай більше контексту.";
}

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};
const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});
const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// Адмін-посилання
function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// ── media helpers ────────────────────────────────────────────────────────────
function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` };
  }
  if (msg.video) {
    const v = msg.video;
    return { type: "video", file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { type: "audio", file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { type: "voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` };
  }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  const path = data.result?.file_path;
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}
async function handleIncomingMedia(env, chatId, userId, msg) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, `🔋 Не вистачає енергії для збереження медіа (потрібно ${need}).\nEnergy: ${links.energy}`);
    return true;
  }
  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(env, chatId, `✅ Збережено на твоєму диску: ${saved?.name || att.name}`);
  return true;
}

// ── SystemHint ───────────────────────────────────────────────────────────────
async function buildSystemHint(env, chatId, userId) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId);

  const blocks = [];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune)   blocks.push(`[Self-Tune]\n${tune}`);
  if (dlg)    blocks.push(dlg);
  return blocks.length ? blocks.join("\n\n") : "";
}

// ── Інтенція “детальніше” та емодзі ─────────────────────────────────────────
function isExpandIntent(s = "") {
  const t = String(s).trim().toLowerCase();
  return (
    /детал|доклад|розгорн|поясни|пояснення|приклад|поясни\s+чому|чому|як працю(є|є\?)|крок/i.test(t)
  );
}
function guessEmoji(text = "") {
  const t = text.toLowerCase();
  if (t.includes("колес")) return "🛞";
  if (t.includes("дзеркал")) return "🪞";
  if (t.includes("авто") || t.includes("машин")) return "🚗";
  if (t.includes("вода") || t.includes("рідина")) return "💧";
  if (t.includes("сонц") || t.includes("світло")) return "☀️";
  if (t.includes("годинник")) return "⌚";
  if (t.includes("електр") || t.includes("струм")) return "⚡";
  if (t.includes("комп'ют") || t.includes("компют")) return "💻";
  if (t.includes("телефон") || t.includes("смартф")) return "📱";
  if (t.includes("серце") || t.includes("здоров")) return "❤️";
  return "💡";
}

// KV helpers
async function kvGet(env, key) { try { return await env.STATE_KV.get(key); } catch { return null; } }
async function kvPut(env, key, val, opts) { try { await env.STATE_KV.put(key, val, opts); } catch {} }

// ── Генерація відповідей ─────────────────────────────────────────────────────
async function generateAi(env, userId, userText, { systemHint, expand = false }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  const emoji = guessEmoji(userText);

  const controlHint = expand
    ? `Відповідай детально українською, структуровано (пункти/підзаголовки), додавай приклади за потреби.`
    : `Відповідай українською дуже стисло (${SUMMARY_MIN}-${SUMMARY_TARGET} символів): один насичений абзац або до 4 коротких пунктів. Без "вступів" і зайвих фраз.`;

  const prompt = `${userText}\n\n[режим]: ${expand ? "детально" : "стисло"}`;

  const llmOut = modelOrder
    ? await askAnyModel(env, modelOrder, prompt, { systemHint: `${systemHint}\n\n${controlHint}` })
    : await think(env, prompt, { systemHint: `${systemHint}\n\n${controlHint}` });

  const text = expand
    ? `${emoji} ${llmOut}`
    : (llmOut.length > (CHUNK - 50)
        ? `${emoji} ${llmOut.slice(0, CHUNK - 50).trim()}…`
        : `${emoji} ${llmOut}`);

  return text;
}

// ── ГОЛОВНИЙ ОБРОБНИК ────────────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
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

  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const text = textRaw;

  const safe = async (fn) => { try { await fn(); } catch { try { await sendPlain(env, chatId, "Внутрішня помилка. Спробуй ще раз трохи пізніше."); } catch {} } };

  // /admin
  if (text === "/admin" || text === "/admin@SentiBot") {
    await safe(async () => {
      if (!isAdmin) { await sendPlain(env, chatId, "Доступ заборонено."); return; }
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!env.GOOGLE_GEMINI_API_KEY;
      const hasCF = !!env.CLOUDFLARE_API_TOKEN && !!env.CF_ACCOUNT_ID;
      const hasOR = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_LLM_BASE_URL;
      const hasFreeKey = !!env.FREE_LLM_API_KEY;

      const lines = [
        "Адмін-панель (швидка діагностика):",
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
        "",
        "— Health:",
      ];

      const entries = mo ? mo.split(",").map(s => s.trim()).filter(Boolean) : [];
      if (entries.length) {
        const health = await getAiHealthSummary(env, entries);
        for (const h of health) {
          const light = h.cool ? "🟥" : (h.slow ? "🟨" : "🟩");
          const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
          lines.push(`${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${h.failStreak || 0}`);
        }
      }

      await sendPlain(env, chatId, lines.join("\n"), {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Відкрити Checklist", url: energyLinks(env, userId).checklist }],
            [{ text: "Керування енергією", url: energyLinks(env, userId).energy }],
          ]
        }
      });
    });
    return json({ ok: true });
  }

  // /ai
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) { await sendPlain(env, chatId, "Напиши запит після /ai або просто надішли текст."); return; }

      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${links.energy}`);
        return;
      }
      await spendEnergy(env, userId, need, "text");

      const systemHint = await buildSystemHint(env, chatId, userId);
      const expand = isExpandIntent(q);
      const out = await generateAi(env, userId, q, { systemHint, expand });

      await kvPut(env, LAST_Q_KEY(userId), q, { expirationTtl: 60 * 60 * 6 });
      await kvPut(env, LAST_MODE_KEY(userId), expand ? "expand" : "summary", { expirationTtl: 60 * 60 * 6 });

      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", out);
      await sendPlain(env, chatId, out);
    });
    return json({ ok: true });
  }

  // Кнопка Google Drive
  if (text === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendPlain(env, chatId, `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`);
        return;
      }
      await setDriveMode(env, userId, true);
      await sendPlain(env, chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", {
        reply_markup: mainKeyboard(isAdmin),
      });
      await sendPlain(env, chatId, "Переглянути вміст диска:", { reply_markup: inlineOpenDrive() });
    });
    return json({ ok: true });
  }

  // Диск: прийом медіа
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendPlain(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // Звичайний текст → визначення режиму
  if (text && !text.startsWith("/")) {
    try {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${links.energy}`);
        return json({ ok: true });
      }
      await spendEnergy(env, userId, need, "text");

      const systemHint = await buildSystemHint(env, chatId, userId);

      // якщо попереднє повідомлення було "summary" і тепер коротке "а чому/поясни/приклад" — вважаємо expand
      const prevMode = await kvGet(env, LAST_MODE_KEY(userId));
      const expand = isExpandIntent(text) || prevMode === "summary" && /^((а )?(чому|поясни|приклад|розгорни|більше|детальніше))[\s\?]*$/i.test(text);

      const out = await generateAi(env, userId, text, { systemHint, expand });

      await kvPut(env, LAST_Q_KEY(userId), text, { expirationTtl: 60 * 60 * 6 });
      await kvPut(env, LAST_MODE_KEY(userId), expand ? "expand" : "summary", { expirationTtl: 60 * 60 * 6 });

      await pushTurn(env, userId, "user", text);
      await pushTurn(env, userId, "assistant", out);

      await sendPlain(env, chatId, out);
      return json({ ok: true });
    } catch {
      await sendPlain(env, chatId, defaultAiReply());
      return json({ ok: true });
    }
  }

  // дефолт
  await sendPlain(env, chatId, "Привіт! Як я можу допомогти?", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}