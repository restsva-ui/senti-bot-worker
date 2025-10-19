// src/routes/webhook.js

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
import { t, pickReplyLanguage, detectFromText } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";

// APIs (локальні інтенти)
import {
  dateIntent, timeIntent, replyCurrentDate, replyCurrentTime
} from "../apis/time.js";
import {
  weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords
} from "../apis/weather.js";

// Геолокація користувача (KV)
import { setUserLocation, getUserLocation } from "../lib/geo.js";

// ── Alias з tg.js ────────────────────────────────────────────────────────────
const {
  BTN_DRIVE, BTN_SENTI, BTN_LEARN, BTN_ADMIN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

// ── CF Vision (безкоштовно) ─────────────────────────────────────────────────
async function cfVisionDescribe(env, imageUrl, userPrompt = "", lang = "uk") {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CF_ACCOUNT_ID) {
    throw new Error("CF credentials missing");
  }
  const model = "@cf/llama-3.2-11b-vision-instruct";
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`;
  const messages = [{
    role: "user",
    content: [
      { type: "input_text", text: `${userPrompt || "Describe the image briefly."} Reply in ${lang}.` },
      { type: "input_image", image_url: imageUrl }
    ]
  }];
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages })
  });
  const data = await r.json().catch(() => null);
  if (!data?.success) {
    const msg = data?.errors?.[0]?.message || `CF vision failed (HTTP ${r.status})`;
    throw new Error(msg);
  }
  const result = data.result?.response || data.result?.output_text || data.result?.text || "";
  return String(result || "").trim();
}

// ── Media helpers ───────────────────────────────────────────────────────────
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
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id })
  });
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  const path = data.result?.file_path;
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}

// Drive-режим
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
  await sendPlain(env, chatId, `✅ ${t(lang, "saved_to_drive")}: ${saved?.name || att.name}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] }
  });
  return true;
}

// Vision-режим
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "vision");
  const url = await tgFileUrl(env, att.file_id);
  const prompt = caption || "Опиши, що на зображенні, коротко і по суті.";
  try {
    const resp = await cfVisionDescribe(env, url, prompt, lang);
    await sendPlain(env, chatId, `🖼️ ${resp}`);
  } catch (e) {
    if (ADMIN(env, userId)) await sendPlain(env, chatId, `❌ Vision error: ${String(e.message || e).slice(0, 180)}`);
    else await sendPlain(env, chatId, t(lang, "default_reply"));
  }
  return true;
}
// ── SystemHint ───────────────────────────────────────────────────────────────
async function buildSystemHint(env, chatId, userId) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId);

  const core = `You are Senti — a thoughtful, self-improving assistant and companion.
- Never claim to be an AI, model, chatbot, or a product made by any company.
- Speak naturally and human-like with warmth and clarity.
- Prefer concise, practical answers; expand only when asked.`;

  const blocks = [core];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (dlg) blocks.push(dlg);
  return blocks.join("\n\n");
}

// ── Emoji + ім’я ─────────────────────────────────────────────────────────────
function guessEmoji(text = "") {
  const tt = text.toLowerCase();
  if (tt.includes("колес") || tt.includes("wheel")) return "🛞";
  if (tt.includes("дзеркал") || tt.includes("зеркал") || tt.includes("mirror")) return "🪞";
  if (tt.includes("машин") || tt.includes("авто") || tt.includes("car")) return "🚗";
  if (tt.includes("вода") || tt.includes("рідина") || tt.includes("water")) return "💧";
  if (tt.includes("світл") || tt.includes("light") || tt.includes("солнц")) return "☀️";
  if (tt.includes("електр") || tt.includes("струм") || tt.includes("current")) return "⚡";
  return "💡";
}
function looksLikeEmojiStart(s = "") { try { return /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(String(s)); } catch { return false; } }
function tryParseUserNamedAs(text) {
  const s = (text || "").trim();
  const NAME_RX = "([A-Za-zÀ-ÿĀ-žЀ-ӿʼ'`\\-\\s]{2,30})";
  const patterns = [
    new RegExp(`\\bмене\\s+звати\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bменя\\s+зовут\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bmy\\s+name\\s+is\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bich\\s+hei(?:s|ß)e\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bje\\s+m'?appelle\\s+${NAME_RX}`, "iu")
  ];
  for (const r of patterns) { const m = s.match(r); if (m?.[1]) return m[1].trim(); }
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

// ── Анти-розкриття “я AI/LLM” + чистка підписів ─────────────────────────────
function revealsAiSelf(out = "") {
  const s = out.toLowerCase();
  return (
    /(^|\b)as an? (ai|language model)\b/.test(s) ||
    /\bi am (an|a)? (ai|language model|large language model)\b/.test(s) ||
    /\bdeveloped by (google|openai|meta|anthropic)\b/.test(s) ||
    /я\s+(є|—|-)?\s*(штучн|модель|мова)/i.test(out) ||
    /я\s+(являюсь|есть)\s+(ии|искусственн|языков)/i.test(out) ||
    /ich bin (ein|eine) (ki|sprachmodell)/i.test(out) ||
    /je suis (une|un) (ia|mod[èe]le de langue)/i.test(out)
  );
}
function stripProviderSignature(s = "") { return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim(); }

// ── Відповідь AI + захист ───────────────────────────────────────────────────
function limitMsg(s, max = 220) { if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1); }
function chunkText(s, size = 3500) { const out = []; let t = String(s || ""); while (t.length) { out.push(t.slice(0, size)); t = t.slice(size); } return out; }
function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x) || /gemini-?2\.5|openrouter|deepseek|llama/i.test(x);
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Never say you're an AI, model, or a product of any company. Write ONLY in ${lang}; sound natural and human-like. Be warm and helpful. Split long ideas into short Telegram-friendly messages.`
    : `You are Senti — an independent, human-like assistant. Never mention being AI/GPT or created by anyone. Write ONLY in ${lang}. Keep it short and helpful (1–3 sentences). Answer directly without restating the question.`;
  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${userText}
${control}`;
  let out;
  try {
    out = modelOrder ? await askAnyModel(env, modelOrder, prompt, { systemHint })
                     : await think(env, prompt, { systemHint });
  } catch (e) {
    if (adminDiag) throw e;
    throw new Error("LLM call failed");
  }
  out = stripProviderSignature((out || "").trim());
  if (looksLikeModelDump(out)) {
    out = stripProviderSignature((await think(env, prompt, { systemHint }))?.trim() || out);
  }
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the previous answer as Senti. Do NOT mention being an AI/model or any company. Keep it in ${lang}, concise and natural.`;
    let cleaned = modelOrder ? await askAnyModel(env, modelOrder, fix, { systemHint }) : await think(env, fix, { systemHint });
    cleaned = stripProviderSignature((cleaned || "").trim());
    if (cleaned) out = cleaned;
  }
  if (!looksLikeEmojiStart(out)) out = `${guessEmoji(userText)} ${out}`;
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. If the previous answer used another language, rewrite it now in ${lang}. Keep it concise.`;
    let fixed = modelOrder ? await askAnyModel(env, modelOrder, hardPrompt, { systemHint }) : await think(env, hardPrompt, { systemHint });
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = looksLikeEmojiStart(fixed) ? fixed : `${guessEmoji(userText)} ${fixed}`;
  }
  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

// ── Learn-mode: прапор у STATE_KV + прийом матеріалів ───────────────────────
const LEARN_FLAG = (uid) => `learn:mode:${uid}`;
async function setLearnMode(env, uid, on) {
  try {
    if (on) await env.STATE_KV.put(LEARN_FLAG(uid), "1", { expirationTtl: 3600 });
    else await env.STATE_KV.delete(LEARN_FLAG(uid));
  } catch {}
}
async function getLearnMode(env, uid) {
  try { return !!(await env.STATE_KV.get(LEARN_FLAG(uid))); } catch { return false; }
}

// Проста URL-евристика
const LOOKS_URL = /\bhttps?:\/\/[^\s)]+/i;

// Занесення до LEARN_QUEUE_KV (спрощено — під твої kv утиліти)
async function enqueueUserLearn(env, uid, item) {
  const key = `learn:queue:${uid}`;
  let arr = [];
  try { const raw = await env.LEARN_QUEUE_KV.get(key); if (raw) arr = JSON.parse(raw); } catch {}
  arr.push({ id: crypto.randomUUID(), ...item });
  await env.LEARN_QUEUE_KV.put(key, JSON.stringify(arr));
  return arr.length;
}

// Прийом: URL з тексту або файл як вкладення
async function handleLearnIntake(env, chatId, userId, msg, lang, textRaw) {
  const learnOn = await getLearnMode(env, userId);
  if (!learnOn) return false;

  // 1) URL із тексту
  const m = textRaw ? textRaw.match(LOOKS_URL) : null;
  if (m) {
    await enqueueUserLearn(env, userId, {
      type: "url", url: m[0], name: m[0], when: Date.now(), status: "queued"
    });
    await sendPlain(env, chatId,
      lang === "uk" ? "✅ Додав у чергу навчання. Опрацюю у фоні та зможу відповідати на питання."
                    : "✅ Added to learning queue. I’ll process it in the background and be ready to answer questions."
    );
    return true;
  }

  // 2) файл як вкладення
  const att = detectAttachment(msg);
  if (att) {
    const url = await tgFileUrl(env, att.file_id);
    await enqueueUserLearn(env, userId, {
      type: "file", url, name: att.name, when: Date.now(), status: "queued"
    });
    await sendPlain(env, chatId,
      lang === "uk" ? "✅ Файл додано у чергу навчання." : "✅ File has been added to the learning queue."
    );
    return true;
  }
  return false;
}
// ── MAIN ────────────────────────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  // Webhook auth guard
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected = env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
    if (expected && sec !== expected) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  // Безпечний парс апдейта
  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }
  const msg = update?.message || update?.edited_message || update?.channel_post || update?.callback_query?.message;
  if (!msg?.chat?.id) return json({ ok: true }); // нічого відповідати
  const chatId = msg.chat.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  let lang = pickReplyLanguage(msg, textRaw);

  const safe = async (fn) => {
    try { await fn(); }
    catch (e) {
      if (isAdmin) await sendPlain(env, chatId, `❌ Error: ${String(e?.message || e).slice(0, 200)}`);
      else try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {}
    }
  };

  // збереження геолокації
  if (msg?.location && userId) {
    await setUserLocation(env, userId, msg.location);
    const okMap = {
      uk: "✅ Локацію збережено. Тепер я можу показувати погоду для вашого місця.",
      ru: "✅ Локация сохранена. Теперь я смогу показывать погоду для вашего места.",
      en: "✅ Location saved. I can now show weather for your area.",
      de: "✅ Standort gespeichert. Ich kann dir jetzt Wetter für deinen Ort zeigen.",
      fr: "✅ Position enregistrée. Je peux maintenant afficher la météo pour ta zone.",
    };
    const ok = okMap[(msg?.from?.language_code || lang || "uk").slice(0,2)] || okMap.uk;
    await sendPlain(env, chatId, ok, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

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
      const markup = { inline_keyboard: [
        [{ text: "Відкрити Checklist", url: links.checklist }],
        [{ text: "Керування енергією", url: links.energy }],
      ]};
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
      const { short, full } = await callSmartLLM(env, q, { lang, name, systemHint, expand, adminDiag: isAdmin });
      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", full);
      const after = (cur.energy - need);
      if (expand && full.length > short.length) { for (const ch of chunkText(full)) await sendPlain(env, chatId, ch); }
      else { await sendPlain(env, chatId, short); }
      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", after, links.energy));
      }
    });
    return json({ ok: true });
  }

  // Кнопка Google Drive
  if (textRaw === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      await setDriveMode(env, userId, true);
      const zeroWidth = "\u2063";
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendPlain(env, chatId, zeroWidth, {
          reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: authUrl }]] }
        });
        return;
      }
      await sendPlain(env, chatId, zeroWidth, {
        reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] }
      });
    });
    return json({ ok: true });
  }

  // Кнопка Senti (вимикаємо Drive/Learn, просто повертаємо клавіатуру)
  if (textRaw === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    await setLearnMode(env, userId, false);
    const zeroWidth = "\u2063";
    await sendPlain(env, chatId, zeroWidth, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // Кнопка Learn: вмикаємо режим прийому матеріалів
  if (textRaw === BTN_LEARN) {
    await setDriveMode(env, userId, false);
    await setLearnMode(env, userId, true);
    const guide =
      "🧠 Learning mode.\n" +
      (lang === "uk"
        ? "Надішліть мені посилання на статтю/відео або файл (PDF, DOCX, TXT) — додам у чергу навчання."
        : "Send me a link to an article/video or a file (PDF, DOCX, TXT). I’ll queue it for learning.");
    await sendPlain(env, chatId, guide, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // Медіа: спочатку Learn (якщо увімкнено), далі Drive/Vision
  try {
    if (await getLearnMode(env, userId)) {
      if (await handleLearnIntake(env, chatId, userId, msg, lang, textRaw)) {
        return json({ ok: true });
      }
    }
    const driveOn = await getDriveMode(env, userId);
    if (driveOn) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    } else {
      if (await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption)) return json({ ok: true });
    }
  } catch (e) {
    if (isAdmin) await sendPlain(env, chatId, `❌ Media error: ${String(e).slice(0, 180)}`);
    else await sendPlain(env, chatId, t(lang, "default_reply"));
    return json({ ok: true });
  }

  // Локальні інтенти: дата/час/погода
  if (textRaw) {
    const wantsDate = dateIntent(textRaw);
    const wantsTime = timeIntent(textRaw);
    const wantsWeather = weatherIntent(textRaw);

    if (wantsDate || wantsTime || wantsWeather) {
      await safe(async () => {
        if (wantsDate) await sendPlain(env, chatId, replyCurrentDate(env, lang));
        if (wantsTime) await sendPlain(env, chatId, replyCurrentTime(env, lang));

        if (wantsWeather) {
          const byPlace = await weatherSummaryByPlace(env, textRaw, lang);
          const notFound = /Не вдалося знайти такий населений пункт\./.test(byPlace.text);
          if (!notFound) {
            await sendPlain(env, chatId, byPlace.text, { parse_mode: byPlace.mode || undefined });
          } else {
            const geo = await getUserLocation(env, userId);
            if (geo?.lat && geo?.lon) {
              const byCoords = await weatherSummaryByCoords(geo.lat, geo.lon, lang);
              await sendPlain(env, chatId, byCoords.text, { parse_mode: byCoords.mode || undefined });
            } else {
              const askMap = {
                uk: "Будь ласка, надішліть вашу локацію кнопкою нижче — і я покажу погоду для вашого місця.",
                ru: "Пожалуйста, отправьте вашу локацию кнопкой ниже — и я покажу погоду для вашего места.",
                en: "Please share your location using the button below — I’ll show the weather for your area.",
                de: "Bitte teile deinen Standort über die Schaltfläche unten – dann zeige ich dir das Wetter für deinen Ort.",
                fr: "Merci d’envoyer ta position via le bouton ci-dessous — je te montrerai la météo pour ta zone.",
              };
              const ask = askMap[lang.slice(0,2)] || askMap.uk;
              await sendPlain(env, chatId, ask, { reply_markup: askLocationKeyboard() });
            }
          }
        }
      });
      return json({ ok: true });
    }
  }

  // Звичайний текст → AI
  if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      await rememberNameFromText(env, userId, textRaw);
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
      const expand = /\b(детальн|подроб|подробнее|more|details|expand|mehr|détails)\b/i.test(textRaw);
      const { short, full } = await callSmartLLM(env, textRaw, { lang, name, systemHint, expand, adminDiag: isAdmin });

      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", full);

      const after = (cur.energy - need);
      if (expand && full.length > short.length) { for (const ch of chunkText(full)) await sendPlain(env, chatId, ch); }
      else { await sendPlain(env, chatId, short); }
      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", after, links.energy));
      }
    });
    return json({ ok: true });
  }

  // Дефолтне привітання
  const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
  const greetLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
  const name = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `${t(greetLang, "hello_name", name)} ${t(greetLang, "how_help")}`, {
    reply_markup: mainKeyboard(isAdmin)
  });
  return json({ ok: true });
}
