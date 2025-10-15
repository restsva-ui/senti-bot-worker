// src/routes/webhook.js
// Telegram webhook: людина-орієнтована відповідь, авто-мова (i18n),
// коротко в 1 sms, за запитом — розгорнуто, емодзі, пам’ять імені,
// Drive-mode, енергія, адмін-меню.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
// i18n
import { t, pickReplyLanguage } from "../lib/i18n.js";

// ── TG helpers ───────────────────────────────────────────────────────────────

async function sendPlain(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {})
  };
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});
}

function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

// ── UI ───────────────────────────────────────────────────────────────────────

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]); // Checklist прибрали з головного меню
  return { keyboard: rows, resize_keyboard: true };
};

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// ── Media ────────────────────────────────────────────────────────────────────

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
  if (msg.voice) return { type: "voice", file_id: msg.voice.file_id, name: `voice_${msg.voice.file_unique_id}.ogg` };
  if (msg.video_note) return { type: "video_note", file_id: msg.video_note.file_id, name: `videonote_${msg.video_note.file_unique_id}.mp4` };
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
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_media", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(env, chatId, `✅ ${saved?.name || att.name}`);
  return true;
}

// ── SystemHint (Статут + Self-Tune + Dialog Memory) ─────────────────────────

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

// ── Мова, ім’я, емодзі ──────────────────────────────────────────────────────

function guessEmoji(text = "") {
  const t = text.toLowerCase();
  if (t.includes("колес") || t.includes("wheel")) return "🛞";
  if (t.includes("дзеркал") || t.includes("зеркал") || t.includes("mirror")) return "🪞";
  if (t.includes("машин") || t.includes("авто") || t.includes("car")) return "🚗";
  if (t.includes("вода") || t.includes("рідина") || t.includes("water")) return "💧";
  if (t.includes("світл") || t.includes("light") || t.includes("солнц")) return "☀️";
  if (t.includes("електр") || t.includes("струм") || t.includes("current")) return "⚡";
  return "💡";
}

// Без \p{…} — RE2-сумісні вирази
function tryParseUserNamedAs(text) {
  const s = (text || "").trim();

  // Дозволимо букви латиниці/кирилиці, пробіли, апостроф/дефіс. 2..30 символів.
  const NAME_RX = "([A-Za-zÀ-ÿĀ-žЀ-ӿʼ'`\\-\\s]{2,30})";

  const patterns = [
    new RegExp(`\\bмене\\s+звати\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bменя\\s+зовут\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bmy\\s+name\\s+is\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bich\\s+hei(?:s|ß)e\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bje\\s+m'?appelle\\s+${NAME_RX}`, "iu"),
  ];
  for (const r of patterns) {
    const m = s.match(r);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

const PROFILE_NAME_KEY = (uid) => `profile:name:${uid}`;
async function getPreferredName(env, msg) {
  const uid = msg?.from?.id;
  const kv = env?.STATE_KV;
  let v = null;
  try { v = await kv.get(PROFILE_NAME_KEY(uid)); } catch {}
  if (v) return v;
  return msg?.from?.first_name || msg?.from?.username || "друже";
}
async function rememberNameFromText(env, userId, text) {
  const name = tryParseUserNamedAs(text);
  if (!name) return null;
  try { await env.STATE_KV.put(PROFILE_NAME_KEY(userId), name); } catch {}
  return name;
}

// ── Генерація відповіді ─────────────────────────────────────────────────────

function limitMsg(s, max = 700) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max - 1);
}
function chunkText(s, size = 3500) {
  const out = [];
  let t = String(s || "");
  while (t.length) {
    out.push(t.slice(0, size));
    t = t.slice(size);
  }
  return out;
}

async function generateAi(env, { userText, lang, name, systemHint, expand }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  const emoji = guessEmoji(userText);

  const control = expand
    ? `Write in **${lang}**.\nTone: warm, helpful, natural.\nSplit into short Telegram-friendly messages.`
    : `Write in **${lang}**.\nTone: friendly, concise, natural.\n1–3 sentences max. If later the user asks for “more/details/детальніше/подробно” — then elaborate.`;

  const prompt = `${control}\nAdd one relevant emoji at the start if natural.\nUser (${name}): ${userText}`;

  const out = modelOrder
    ? await askAnyModel(env, modelOrder, prompt, { systemHint })
    : await think(env, prompt, { systemHint });

  const text = (out || "").trim() || t(lang, "default_reply");
  const short = expand ? text : limitMsg(text, 700);
  return { emoji, text: short, full: text };
}

// ── ГОЛОВНИЙ ОБРОБНИК ───────────────────────────────────────────────────────

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

  const lang = pickReplyLanguage(msg, textRaw);

  const safe = async (fn) => {
    try { await fn(); } catch {
      try { await sendPlain(env, chatId, "Внутрішня помилка. Спробуй ще раз трохи пізніше."); } catch {}
    }
  };

  // /admin або кнопка Admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      if (!isAdmin) { await sendPlain(env, chatId, t(lang, "admin_denied")); return; }
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!env.GOOGLE_GEMINI_API_KEY;
      const hasCF = !!env.CLOUDFLARE_API_TOKEN && !!env.CF_ACCOUNT_ID;
      const hasOR = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_LLM_BASE_URL;
      const hasFreeKey = !!env.FREE_LLM_API_KEY;

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
          [{ text: "Керування енергією", url: links.energy }]
        ]
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
      if (!q) {
        await sendPlain(env, chatId, "Напиши запит після /ai, або просто відправ текст без команди — я відповім як зазвичай.");
        return;
      }

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
      const expand = /\b(детальн|подроб|more|details|expand)\b/i.test(q);

      const { text, full } = await generateAi(env, { userText: q, lang, name, systemHint, expand });

      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", full);

      const left = (cur.energy - need);
      if (expand && full.length > text.length) {
        for (const chunk of chunkText(full)) await sendPlain(env, chatId, chunk);
      } else {
        await sendPlain(env, chatId, text);
      }
      if (left <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", left, links.energy));
      }
    });
    return json({ ok: true });
  }

  // Google Drive
  if (textRaw === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendPlain(env, chatId, `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`);
        return;
      }
      await setDriveMode(env, userId, true);
      await sendPlain(env, chatId, t(lang, "disk_on"), { reply_markup: mainKeyboard(isAdmin) });
      await sendPlain(env, chatId, t(lang, "open_drive_btn"), {
        reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] }
      });
    });
    return json({ ok: true });
  }

  // Кнопка Senti → дружня підказка
  if (textRaw === BTN_SENTI) {
    const name = await getPreferredName(env, msg);
    await sendPlain(env, chatId, `${t(lang, "hello_name", name)}\n${t(lang, "senti_tip")}`, {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // Медіа в режимі диска
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
  } catch (e) {
    await sendPlain(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
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
      const expand = /\b(детальн|подроб|more|details|expand)\b/i.test(textRaw);

      const { text, full } = await generateAi(env, { userText: textRaw, lang, name, systemHint, expand });

      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", full);

      const left = (cur.energy - need);
      if (expand && full.length > text.length) {
        for (const chunk of chunkText(full)) await sendPlain(env, chatId, chunk);
      } else {
        await sendPlain(env, chatId, text);
      }
      if (left <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", left, links.energy));
      }
      return json({ ok: true });
    } catch {
      await sendPlain(env, chatId, t(lang, "default_reply"));
      return json({ ok: true });
    }
  }

  // Дефолтне привітання з ім’ям і мовою
  const welcomeName = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `${t(lang, "hello_name", welcomeName)} Як я можу допомогти?`, {
    reply_markup: mainKeyboard(isAdmin),
  });
  return json({ ok: true });
}