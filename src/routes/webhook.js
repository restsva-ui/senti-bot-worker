// src/routes/webhook.js
// Telegram webhook з інтеграцією мозку, Статутом, Self-Tune, Dialog Memory, режимом диска.
// Відповідає розмовною мовою, автоматично обирає мову, пам’ятає ім’я, стисло/детально за інтенцією.
// Надсилання без parse_mode (щоб уникати MarkdownV2-помилок).

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

// ── Константи ────────────────────────────────────────────────────────────────
const CHUNK = 3500;                 // безпечний шматок < 4096 tg
const SUMMARY_TARGET = 800;         // ~1 SMS
const SUMMARY_MIN = 450;

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";

const NAME_KEY = (u) => `user:name:${u}`;
const LANG_KEY = (u) => `user:lang:${u}`;
const LAST_MODE_KEY = (u) => `dialog:last:mode:${u}`; // summary | expand

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// ── Допоміжні ────────────────────────────────────────────────────────────────
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

  // Розбити на частини
  let rest = text;
  while (rest.length) {
    if (rest.length <= CHUNK) { await send(rest); break; }
    let cut = rest.lastIndexOf("\n", CHUNK);
    if (cut < CHUNK * 0.6) cut = rest.lastIndexOf(". ", CHUNK);
    if (cut < CHUNK * 0.5) cut = CHUNK;
    await send(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
    extra = {};
  }
}

function parseAiCommand(text = "") {
  const m = String(text).trim().match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});

function adminLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

async function kvGet(env, key, def = null) {
  try { const v = await env.STATE_KV.get(key); return v ?? def; } catch { return def; }
}
async function kvPut(env, key, val, opts) {
  try { await env.STATE_KV.put(key, val, opts); } catch {}
}

// ── Media ───────────────────────────────────────────────────────────────────
function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) { const d = msg.document; return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` }; }
  if (msg.video)    { const v = msg.video;    return { type: "video", file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` }; }
  if (msg.audio)    { const a = msg.audio;    return { type: "audio", file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` }; }
  if (msg.voice)    { const v = msg.voice;    return { type: "voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` }; }
  if (msg.video_note){const v = msg.video_note;return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` }; }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id }),
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
    const links = adminLinks(env, userId);
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
async function buildSystemHint(env, chatId, userId, lang, name) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId);

  const persona = [
    `[Persona] You are Senti – a friendly, helpful assistant. Speak in a natural, conversational style.`,
    `Use the language code: ${lang}. Address the user by name occasionally (${name || "friend"}), but don't overuse.`,
    `Be concise by default. If the user clearly asks for more detail, provide a thorough multi-message explanation.`,
  ].join("\n");

  const blocks = [persona];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune)   blocks.push(`[Self-Tune]\n${tune}`);
  if (dlg)    blocks.push(dlg);
  return blocks.join("\n\n");
}

// ── Мова/імʼя/інтенції ───────────────────────────────────────────────────────
function detectLangFromText(t) {
  const s = (t || "").toLowerCase();
  // дуже прості евристики
  if (/[їієґ]/.test(s)) return "uk";
  if (/[ёъэ]/.test(s)) return "ru";
  if (/[äöüß]/.test(s)) return "de";
  if (/\b(le|la|les|des|un|une|et|est|avec)\b/.test(s)) return "fr";
  if (/[a-z]/.test(s)) return "en";
  return null;
}
function normalizeLang(code) {
  const c = (code || "").toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("fr")) return "fr";
  return "en";
}
function isExpandIntent(s = "") {
  const t = String(s).trim().toLowerCase();
  return /детал|доклад|розгорн|поясни|приклад|чому|крок|инструкц|подробнее|пояснение|example|explain|why|steps|details|détaill|erklä|warum|beispiel/i.test(t);
}
function guessEmoji(text = "") {
  const t = text.toLowerCase();
  if (t.includes("колес")) return "🛞";
  if (t.includes("дзеркал")) return "🪞";
  if (t.includes("машин") || t.includes("авто")) return "🚗";
  if (t.includes("вода") || t.includes("рідина")) return "💧";
  if (t.includes("світл") || t.includes("солнц") || t.includes("light")) return "☀️";
  if (t.includes("електр") || t.includes("струм") || t.includes("current")) return "⚡";
  return "💡";
}
function tryParseUserNamedAs(text) {
  const s = (text || "").trim();
  const rx = [
    /мене звати\s+([\p{L}\-\'\s]{2,30})/iu,
    /меня зовут\s+([\p{L}\-\'\s]{2,30})/iu,
    /my name is\s+([\p{L}\-\'\s]{2,30})/iu,
    /ich hei(?:s|ß)e\s+([\p{L}\-\'\s]{2,30})/iu,
    /je m(?:'|’)?appelle\s+([\p{L}\-\'\s]{2,30})/iu,
  ];
  for (const r of rx) {
    const m = s.match(r);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// ── Генерація відповіді ──────────────────────────────────────────────────────
async function generateAi(env, { userId, userText, lang, name, systemHint, expand }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  const emoji = guessEmoji(userText);

  // Керування стилем
  const control = expand
    ? `Write a detailed, well-structured answer in ${lang}. Use lists and short paragraphs. Keep it helpful and friendly.`
    : `Give a very concise answer in ${lang} (${SUMMARY_MIN}-${SUMMARY_TARGET} chars). One dense paragraph OR up to 4 short bullets. No fluff.`;

  const prompt = `${userText}\n\n[mode]: ${expand ? "detailed" : "concise"}`;

  const out = modelOrder
    ? await askAnyModel(env, modelOrder, prompt, { systemHint: `${systemHint}\n\n${control}` })
    : await think(env, prompt, { systemHint: `${systemHint}\n\n${control}` });

  const maybeName = name ? `${name}, ` : "";
  const text = expand
    ? `${emoji} ${out}`
    : `${emoji} ${out}`;

  // Легкий захист від наддовгих відповідей у стислому режимі
  return expand ? text : (text.length > CHUNK - 20 ? text.slice(0, CHUNK - 20).trim() + "…" : text);
}

// ── Основний обробник ───────────────────────────────────────────────────────
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
  const tgLang = normalizeLang(msg?.from?.language_code || "en");
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();

  const safe = async (fn) => {
    try { await fn(); } catch (e) {
      try { await sendPlain(env, chatId, "Внутрішня помилка. Спробуй ще раз трохи пізніше."); } catch {}
    }
  };

  // — Підготовка імені/мови
  let prefName = await kvGet(env, NAME_KEY(userId));
  if (!prefName) prefName = msg?.from?.first_name || msg?.from?.username || null;

  // Якщо юзер представився — запамʼятати
  const named = tryParseUserNamedAs(textRaw);
  if (named) {
    prefName = named;
    await kvPut(env, NAME_KEY(userId), prefName, { expirationTtl: 60 * 60 * 24 * 90 });
  }

  // Мова: із памʼяті → з тексту → з Telegram → en
  let prefLang = await kvGet(env, LANG_KEY(userId));
  const langByText = detectLangFromText(textRaw);
  prefLang = normalizeLang(prefLang || langByText || tgLang);
  await kvPut(env, LANG_KEY(userId), prefLang, { expirationTtl: 60 * 60 * 24 * 90 });

  // /admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot") {
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
            [{ text: "Відкрити Checklist", url: adminLinks(env, userId).checklist }],
            [{ text: "Керування енергією", url: adminLinks(env, userId).energy }],
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
      if (!q) { await sendPlain(env, chatId, "Напиши запит після /ai, або просто відправ текст без команди — я відповім 🙂"); return; }

      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = adminLinks(env, userId);
        await sendPlain(env, chatId, `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${links.energy}`);
        return;
      }
      await spendEnergy(env, userId, need, "text");

      const expand = isExpandIntent(q);
      const systemHint = await buildSystemHint(env, chatId, userId, prefLang, prefName);
      const out = await generateAi(env, { userId, userText: q, lang: prefLang, name: prefName, systemHint, expand });

      await kvPut(env, LAST_MODE_KEY(userId), expand ? "expand" : "summary", { expirationTtl: 60 * 60 * 6 });
      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", out);
      await sendPlain(env, chatId, out);
    });
    return json({ ok: true });
  }

  // Кнопки
  if (textRaw === BTN_DRIVE) {
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

  if (textRaw === BTN_SENTI) {
    const helloByLang = {
      uk: `Привіт, ${prefName || "друже"}! Що підказати?`,
      ru: `Привет, ${prefName || "друг"}! Чем помочь?`,
      en: `Hey ${prefName || "there"}! How can I help?`,
      de: `Hi ${prefName || "du"}! Womit kann ich helfen?`,
      fr: `Salut ${prefName || "toi"} ! Comment puis-je aider ?`,
    };
    await sendPlain(env, chatId, helloByLang[prefLang] || helloByLang.en, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  if (textRaw === BTN_ADMIN && isAdmin) {
    // підказка: користуйся /admin
    await sendPlain(env, chatId, "Натисни /admin для діагностики.", { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // Режим диска — перехоплення медіа
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendPlain(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // Звичайний текст → AI
  if (textRaw && !textRaw.startsWith("/")) {
    try {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = adminLinks(env, userId);
        await sendPlain(env, chatId, `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${links.energy}`);
        return json({ ok: true });
      }
      await spendEnergy(env, userId, need, "text");

      // оновимо мову за цим повідомленням
      const fromText = detectLangFromText(textRaw);
      if (fromText) { prefLang = normalizeLang(fromText); await kvPut(env, LANG_KEY(userId), prefLang, { expirationTtl: 60 * 60 * 24 * 90 }); }

      const prevMode = await kvGet(env, LAST_MODE_KEY(userId));
      const expand = isExpandIntent(textRaw) || (prevMode === "summary" && /^((а )?(чому|поясни|приклад|детальніше|подробнее|more|explain))[\s\?]*$/i.test(textRaw));
      const systemHint = await buildSystemHint(env, chatId, userId, prefLang, prefName);

      const out = await generateAi(env, { userId, userText: textRaw, lang: prefLang, name: prefName, systemHint, expand });

      await kvPut(env, LAST_MODE_KEY(userId), expand ? "expand" : "summary", { expirationTtl: 60 * 60 * 6 });
      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", out);

      // попередження про низьку енергію — вкінці
      const after = (cur.energy - need);
      if (after <= Number(cur.low ?? 10)) {
        const links = adminLinks(env, userId);
        await sendPlain(env, chatId, `${out}\n\n⚠️ Низький рівень енергії (${after}). Керування: ${links.energy}`);
      } else {
        await sendPlain(env, chatId, out);
      }
      return json({ ok: true });
    } catch {
      await sendPlain(env, chatId, "Вибач, не вийшло відповісти. Спробуєш ще раз?");
      return json({ ok: true });
    }
  }

  // дефолт
  const helloByLang = {
    uk: `Привіт, ${prefName || "друже"}! Як я можу допомогти?`,
    ru: `Привет, ${prefName || "друг"}! Чем помочь?`,
    en: `Hi ${prefName || "there"}! How can I help?`,
    de: `Hi ${prefName || "du"}! Womit kann ich helfen?`,
    fr: `Salut ${prefName || "toi"} ! Comment puis-je aider ?`,
  };
  await sendPlain(env, chatId, helloByLang[prefLang] || helloByLang.en, { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}