// src/routes/webhook.js
// Telegram webhook: нормальне спілкування «людською» мовою,
// авто-мова, коротка відповідь за замовчуванням,
// “детальніше/ще/expand” — розгортання у кілька повідомлень,
// емодзі за темою, пам’ять імені, режим диска, енергія, адмін-меню.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";

// Енергія
import { getEnergy, spendEnergy } from "../lib/energy.js";

// Пам’ять діалогу
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";

// Self-Tune
import { loadSelfTune } from "../lib/selfTune.js";

// Drive-mode
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";

// ─────────────────────────────────────────────────────────────────────────────
// TG helpers

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
function defaultAiReply() {
  return "Вибач, зараз не готовий відповісти чітко. Спробуй переформулювати або дай більше контексту.";
}

// ─────────────────────────────────────────────────────────────────────────────
// UI

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";

const mainKeyboard = (isAdmin = false) => {
  // Прибрали Checklist з основної клавіатури
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Media

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

// ─────────────────────────────────────────────────────────────────────────────
// SystemHint (Статут + Self-Tune + Dialog Memory)

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

// ─────────────────────────────────────────────────────────────────────────────
// Мова, ім’я, емодзі

function detectLangFromText(s = "") {
  const t = (s || "").toLowerCase();
  if (/[äöüß]/.test(t) || /\b(der|die|und|ist|wer|bist|nicht)\b/.test(t)) return "de";
  if (/[éèêàçù]/.test(t) || /\b(qui|pourquoi|comment|bonjour)\b/.test(t)) return "fr";
  if (/\b(что|как|привет|зачем|почему)\b/.test(t) || /[а-яё]/.test(t)) return "ru";
  if (/\b(що|як|привіт|будь|будь ласка)\b/.test(t) || /[іїєґ]/.test(t)) return "uk";
  return "en";
}
function pickReplyLanguage(msg, text) {
  const tg = (msg?.from?.language_code || "").split("-")[0].toLowerCase();
  const byText = detectLangFromText(text);
  return byText || tg || "uk";
}
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

function tryParseUserNamedAs(text) {
  const s = (text || "").trim();
  const rx = [
    /мене звати\s+([\p{L}\-\'\s]{2,30})/iu,
    /меня зовут\s+([\p{L}\-\'\s]{2,30})/iu,
    /my name is\s+([\p{L}\-\'\s]{2,30})/iu,
    /ich heiße\s+([\p{L}\-\'\s]{2,30})/iu,
    /je m'?appelle\s+([\p{L}\-\'\s]{2,30})/iu,
  ];
  for (const r of rx) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Генерація відповіді

function limitMsg(s, max = 3800) {
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

async function generateAi(env, { userId, userText, lang, name, systemHint, expand }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  const emoji = guessEmoji(userText);

  const control = expand
    ? `Write in **${lang}**.\nTone: warm, helpful, natural.\nSplit into short Telegram-friendly messages.`
    : `Write in **${lang}**.\nTone: friendly, concise, natural.\n1–3 sentences max. If a follow-up like “детальніше/expand/подробно/tell me more” appears later — then elaborate.`;

  const prompt = `${control}\nIf you can, add one relevant emoji at the start.\nUser (${name}): ${userText}`;

  const out = modelOrder
    ? await askAnyModel(env, modelOrder, prompt, { systemHint })
    : await think(env, prompt, { systemHint });

  const text = out?.trim() || defaultAiReply();
  const finalShort = expand ? text : limitMsg(text, 700); // ~1 sms

  return { emoji, text: finalShort, full: text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Головний обробник

export async function handleTelegramWebhook(req, env) {
  // секрет TG webhook
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

  const safe = async (fn) => {
    try { await fn(); } catch {
      try { await sendPlain(env, chatId, "Внутрішня помилка. Спробуй ще раз трохи пізніше."); } catch {}
    }
  };

  // /admin
  if (text === "/admin" || text === "/admin@SentiBot" || text === BTN_ADMIN) {
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

      // інлайн тільки тут
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
        await sendPlain(env, chatId, `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${links.energy}`);
        return;
      }
      await spendEnergy(env, userId, need, "text");

      const systemHint = await buildSystemHint(env, chatId, userId);
      const lang = pickReplyLanguage(msg, q);
      const name = await getPreferredName(env, msg);

      const expand = /\b(детальн|подроб|more|details|expand)\b/i.test(q);
      const { text: short, full } = await generateAi(env, { userId, userText: q, lang, name, systemHint, expand });

      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", full);

      const curAfter = (cur.energy - need);
      if (curAfter <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, `${short}\n\n⚠️ Низький рівень енергії (${curAfter}). Відновиться автоматично. Керування: ${links.energy}`);
      } else {
        // якщо просили «детальніше», ріжемо на шматки
        if (expand && full.length > short.length) {
          for (const chunk of chunkText(full)) await sendPlain(env, chatId, chunk);
        } else {
          await sendPlain(env, chatId, short);
        }
      }
    });
    return json({ ok: true });
  }

  // Google Drive
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

  // Кнопка Senti → дружня підказка (більше не технічний розбір)
  if (text === BTN_SENTI) {
    await safe(async () => {
      const name = await getPreferredName(env, msg);
      const hello = `Привіт, ${name}! Я Senti 🤝`;
      const tip = "Пиши запит будь-якою мовою — відповім коротко (в одну SMS). Якщо захочеш ширше пояснення — просто скажи «детальніше».";
      await sendPlain(env, chatId, `${hello}\n${tip}`, { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // зберігаємо медіа в режимі диска
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendPlain(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // Звичайний текст → AI
  if (text && !text.startsWith("/")) {
    try {
      // якщо користувач назвався — запам’ятати
      await rememberNameFromText(env, userId, text);

      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${links.energy}`);
        return json({ ok: true });
      }
      await spendEnergy(env, userId, need, "text");

      const systemHint = await buildSystemHint(env, chatId, userId);
      const lang = pickReplyLanguage(msg, text);
      const name = await getPreferredName(env, msg);
      const expand = /\b(детальн|подроб|more|details|expand)\b/i.test(text);

      const { text: short, full } = await generateAi(env, { userId, userText: text, lang, name, systemHint, expand });

      await pushTurn(env, userId, "user", text);
      await pushTurn(env, userId, "assistant", full);

      const after = (cur.energy - need);
      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, `${short}\n\n⚠️ Низький рівень енергії (${after}). Керування: ${links.energy}`);
      } else {
        if (expand && full.length > short.length) {
          for (const chunk of chunkText(full)) await sendPlain(env, chatId, chunk);
        } else {
          await sendPlain(env, chatId, short);
        }
      }
      return json({ ok: true });
    } catch {
      await sendPlain(env, chatId, defaultAiReply());
      return json({ ok: true });
    }
  }

  // дефолтне привітання — з ім’ям
  const welcomeName = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `Привіт, ${welcomeName}! Як я можу допомогти?`, { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}