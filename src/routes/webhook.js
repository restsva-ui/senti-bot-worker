// src/routes/webhook.js
// Telegram webhook для Senti: вітання 1 раз при /start, кнопка "Senti" — без вітання,
// фото віддаємо у Vision API: POST /api/vision?s=WEBHOOK_SECRET

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
import { t } from "../lib/i18n.js";

// ── Local language fallbacks (бо у i18n.js може не бути старих експортів) ──
function detectFromText(s = "") {
  const x = String(s || "").toLowerCase();
  if (/[а-яіїєґ]/i.test(s)) {
    if (/[іїєґ]/i.test(s)) return "uk";
    return "ru";
  }
  if (/[a-z]/i.test(s)) {
    if (/\b(ich|und|nicht|danke|bitte)\b/i.test(x)) return "de";
    if (/\b(je|bonjour|merci|avec|pour|pas)\b/i.test(x)) return "fr";
    return "en";
  }
  return null;
}
function pickReplyLanguage(msg, text = "") {
  const lc = String(msg?.from?.language_code || "").slice(0,2).toLowerCase();
  if (["uk","ru","en","de","fr"].includes(lc)) return lc;
  const d = detectFromText(text);
  return d || "uk";
}

// ── TG helpers ───────────────────────────────────────────────────────────────
async function sendPlain(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {})
  };
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});
}
async function sendTyping(env, chatId) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  }).catch(() => {});
}

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";
const ADMIN = (env, uid) => String(uid) === String(env.TELEGRAM_ADMIN_ID);
const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist?${qs}`)
  };
}

// ── One-time greeting KV ─────────────────────────────────────────────────────
const FIRST_SEEN_KEY = (uid) => `user:first_seen:${uid}`;
async function wasFirstSeen(env, uid){ try { return !!(await env.STATE_KV.get(FIRST_SEEN_KEY(uid))); } catch { return false; } }
async function setFirstSeen(env, uid){ try { await env.STATE_KV.put(FIRST_SEEN_KEY(uid), "1"); } catch {} }
// ── Media helpers ────────────────────────────────────────────────────────────
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
  if (msg.photo?.length) return pickPhoto(msg);
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

async function tgFileUrl(env, fileId) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const r = await fetch(url).catch(() => null);
  if (!r) throw new Error("getFile: fetch failed");
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
  await sendPlain(env, chatId, `✅ ${t(lang, "saved_to_drive")}: ${saved?.name || att.name}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] }
  });
  return true;
}

// ── SystemHint для LLM ───────────────────────────────────────────────────────
async function buildSystemHint(env, chatId, userId) {
  const statut = String((await readStatut(env)) || "").trim();
  const self = await loadSelfTune(env, userId);
  const hint = await buildDialogHint(env, userId);
  const lines = [];
  if (statut) lines.push(`STATUT:\n${statut}`);
  if (self) lines.push(`SELF_TUNE:\n${self}`);
  if (hint) lines.push(`DIALOG_HINT:\n${hint}`);
  return lines.join("\n\n");
}

// ── Зберігання імені користувача ────────────────────────────────────────────
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
  for (const r of patterns) {
    const m = s.match(r);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}
const PROFILE_NAME_KEY = (uid) => `profile:name:${uid}`;
async function getPreferredName(env, msg) {
  const uid = msg?.from?.id;
  const stored = uid ? (await env.STATE_KV.get(PROFILE_NAME_KEY(uid))) : null;
  return stored || msg?.from?.first_name || msg?.from?.username || "друже";
}
async function rememberNameFromText(env, uid, text) {
  const nm = tryParseUserNamedAs(text);
  if (!nm) return;
  try { await env.STATE_KV.put(PROFILE_NAME_KEY(uid), nm); } catch {}
}
// ── LLM helpers ──────────────────────────────────────────────────────────────
function stripProviderSignature(s = "") {
  return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim();
}
function limitMsg(s, max = 220) { if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1); }
function chunkText(s, size = 3500) { const out = []; let t = String(s || ""); while (t.length) { out.push(t.slice(0, size)); t = t.slice(size); } return out; }
function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x) ||
         /gemini-?2\.5|openrouter|deepseek|llama/i.test(x);
}
function guessEmoji(s = "") {
  const t = (s || "").toLowerCase();
  if (t.includes("привіт") || t.includes("hello") || t.includes("bonjour")) return "👋";
  if (t.includes("дякую") || t.includes("merci") || t.includes("thanks")) return "🙏";
  if (t.includes("машин") || t.includes("авто") || t.includes("car")) return "🚗";
  if (t.includes("вода") || t.includes("рідина") || t.includes("water")) return "💧";
  if (t.includes("світл") || t.includes("light") || t.includes("солнц")) return "☀️";
  if (t.includes("електр") || t.includes("струм") || t.includes("current")) return "⚡";
  return "💡";
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Expand ideas but keep them scannable.`
    : `You are Senti — an independent assistant. Be honest. Keep replies short (2–3 sentences).`;

  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${userText}
${control}`;

  let out = modelOrder ? await askAnyModel(env, modelOrder, prompt, { systemHint })
                       : await think(env, prompt, { systemHint });

  out = stripProviderSignature(String(out || "").trim());
  if (!/^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(out)) out = `${guessEmoji(userText)} ${out}`;
  if (looksLikeModelDump(out)) out = "Складні технічні деталі опущено. Постав уточнення, якщо потрібно.";

  // Синхронізація мови відповіді
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. Rewrite: ${out}`;
    let fixed = modelOrder ? await askAnyModel(env, modelOrder, hardPrompt, { systemHint })
                           : await think(env, hardPrompt, { systemHint });
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(fixed) ? fixed : `${guessEmoji(userText)} ${fixed}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

// ── Vision intent helpers ───────────────────────────────────────────────────
function isVisionIntent(text = "") {
  const s = (text || "").toLowerCase().trim();
  if (!s) return false;
  return (
    /^\/vision\b/.test(s) ||
    /що\s+на\s+фото|опиши\s+(це|це\s+фото|зображення)|опиши\s+фото/i.test(s) ||
    /what'?s?\s+in\s+the\s+photo|describe\s+(this|the)\s+(image|photo|picture)/i.test(s)
  );
}

async function callOpenRouterVision(env, prompt, imageUrl) {
  const apiKey = env.OPENROUTER_API_KEY;
  const model = env.OPENROUTER_MODEL_VISION || "openai/gpt-4o-mini";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://senti-bot-worker.restsva.workers.dev",
      "X-Title": "Senti Vision"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }
      ],
      temperature: 0.6
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${d?.error?.message || d?.error || "unknown"}`);
  return String(d?.choices?.[0]?.message?.content || "").trim();
}

async function runVisionOnPhoto(env, chatId, userId, photoMsg, prompt, lang, isAdmin) {
  if (!photoMsg) { await sendPlain(env, chatId, t(lang, "need_photo_hint")); return; }

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_media", need, links.energy));
    return;
  }
  await spendEnergy(env, userId, need, "vision");

  const fileUrl = await tgFileUrl(env, photoMsg.file_id);

  // 1) внутрішній /api/vision
  try {
    const u = new URL(abs(env, "/api/vision"));
    if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
    const r = await fetch(u.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: prompt || "Опиши зображення", images: [fileUrl] })
    });
    const isJson = (r.headers.get("content-type") || "").includes("application/json");
    const d = isJson ? await r.json().catch(() => ({})) : {};
    if (d?.ok) {
      const out = d.result || d.text || d.answer || d.description || "(порожня відповідь)";
      await sendPlain(env, chatId, out);
      return;
    } else if (isAdmin) {
      const why = d?.error || (Array.isArray(d?.details) ? d.details.join(" | ") : "") || `status ${r.status}`;
      await sendPlain(env, chatId, `Vision API fail: ${why}`);
    }
  } catch (e) {
    if (isAdmin) await sendPlain(env, chatId, `Vision API error: ${String(e.message || e)}`);
  }

  // 2) фолбек — OpenRouter
  try {
    const out = await callOpenRouterVision(env, prompt || "Опиши зображення", fileUrl);
    await sendPlain(env, chatId, out);
  } catch (e) {
    await sendPlain(env, chatId, `Vision error: ${String(e.message || e)}`);
  }
}
// ── Webhook: основна логіка ──────────────────────────────────────────────────
export async function handleWebhook(req, env, url) {
  if (req.method === "GET") {
    return json({ ok: true, note: "webhook alive (GET)" });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  let lang = pickReplyLanguage(msg, textRaw);

  const safe = async (fn) => { try { await fn(); } catch { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} } };

  // Vision intent ДО всього іншого
  if (pickPhoto(msg) && isVisionIntent(textRaw)) {
    await safe(() => runVisionOnPhoto(env, chatId, userId, msg, textRaw.replace(/^\/vision(?:@[\w_]+)?/i,"").trim(), lang, isAdmin));
    return json({ ok: true });
  }
  if (!pickPhoto(msg) && isVisionIntent(textRaw) && pickPhoto(msg?.reply_to_message)) {
    await safe(() => runVisionOnPhoto(env, chatId, userId, msg.reply_to_message, textRaw.replace(/^\/vision(?:@[\w_]+)?/i,"").trim(), lang, isAdmin));
    return json({ ok: true });
  }

  // /admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      if (!isAdmin) { await sendPlain(env, chatId, t(lang, "admin_denied")); return; }
      const mo = (env.MODEL_ORDER || "").trim();
      const hasGem = !!env.GEMINI_API_KEY;
      const hasOR  = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_API_BASE_URL;
      const hasFreeKey  = !!env.FREE_API_KEY;
      const lines = [
        `Admin OK`,
        `MODEL_ORDER: ${mo || "(none)"}`,
        `Gemini: ${hasGem ? "✅" : "❌"}`,
        `OpenRouter: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`
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
        [{ text: "Керування енергією", url: links.energy }]
      ]};
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: markup });
    });
    return json({ ok: true });
  }

  // /ai (розгорнута відповідь)
  function parseAiCommand(text = "") {
    const s = String(text).trim();
    const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
    if (!m) return null;
    return (m[1] || "").trim();
  }
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
      const { short, full } = await callSmartLLM(env, q, { lang, name, systemHint, expand: true });
      for (const ch of chunkText(short, 3500)) await sendPlain(env, chatId, ch);
      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", full);
    });
    return json({ ok: true });
  }
// /vision команда (явна)
  if (/^\/vision(?:@[\w_]+)?/i.test(textRaw)) {
    await (async () => {
      const photoNow = pickPhoto(msg);
      const photoReply = pickPhoto(msg?.reply_to_message);
      const photoMsg = photoNow || photoReply;
      const prompt = textRaw.replace(/^\/vision(?:@[\w_]+)?/i, "").trim() || "Опиши зображення";
      await runVisionOnPhoto(env, chatId, userId, photoMsg, prompt, lang, isAdmin);
    })().catch(async () => { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} });
    return json({ ok: true });
  }

  // Google Drive
  if (textRaw === BTN_DRIVE) {
    await (async () => {
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
    })().catch(async () => { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} });
    return json({ ok: true });
  }

  // /start — ПРИВІТАННЯ ОДИН РАЗ; кнопка "Senti" — без вітання
  if (/^\/start\b/i.test(textRaw)) {
    await (async () => {
      const kb = { reply_markup: mainKeyboard(ADMIN(env, userId)) };
      const seen = await wasFirstSeen(env, userId);
      if (!seen) {
        const name = msg?.from?.first_name || "друже";
        const hello = `${t(lang, "hello_name", name)}\n${t(lang,"senti_tip")}`;
        await sendPlain(env, chatId, hello, kb);
        await setFirstSeen(env, userId);
      } else {
        await sendPlain(env, chatId, t(lang, "how_help") || "Чим допомогти?", kb);
      }
    })().catch(async () => { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} });
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI) {
    // Тихий перехід у режим без вітання
    return json({ ok: true });
  }

  // Якщо прийшов медіафайл — збереження у Drive (коли режим увімкнено)
  if (detectAttachment(msg)) {
    await (async () => {
      const mode = await getDriveMode(env, userId);
      if (mode) await handleIncomingMedia(env, chatId, userId, msg, lang);
      else await sendPlain(env, chatId, t(lang, "drive_hint_enable"));
    })().catch(async () => { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} });
    return json({ ok: true });
  }

  // За замовчуванням — коротка відповідь через LLM (без /ai)
  if (textRaw) {
    await (async () => {
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
      const { short, full } = await callSmartLLM(env, textRaw, { lang, name, systemHint, expand: false });
      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", full);
      await sendPlain(env, chatId, short, { reply_markup: mainKeyboard(ADMIN(env, userId)) });
      const cur2 = await getEnergy(env, userId);
      if ((cur2.energy ?? 0) <= Number(cur2.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", cur2.energy, links.energy));
      }
      await rememberNameFromText(env, userId, textRaw).catch(() => {});
    })().catch(async () => { try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} });
    return json({ ok: true });
  }

  return json({ ok: true });
}

export default { handleWebhook };