// src/lib/tg.js
import { abs } from "../utils/url.js";

/* ───────────────────── КНОПКИ ───────────────────── */
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";   // лише для адміна
export const BTN_ADMIN = "Admin";
export const BTN_CODE  = "Code";

/* ───────────────── ГОЛОВНА КЛАВІАТУРА ─────────────
   «Code» вмикає код-режим, «Senti» його вимикає (повернення до базового).
*/
export const mainKeyboard = (isAdmin = false) => {
  const row1 = [{ text: BTN_DRIVE }, { text: BTN_SENTI }, { text: BTN_CODE }];
  const rows = [row1];
  if (isAdmin) rows.push([{ text: BTN_LEARN }, { text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

/* ──────────────── КНОПКА ЗАПИТУ ЛОКАЦІЇ ─────────── */
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

/* ───────────────────── АДМІН-ПЕРЕВІРКА ──────────── */
export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

/* ──────────────── КОРИСНІ ЛІНКИ ДЛЯ UI ──────────── */
export function energyLinks(env, userId) {
  const s =
    env.WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    env.TG_WEBHOOK_SECRET ||
    "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy:    abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
    learn:     abs(env, `/admin/learn/html?${qs}`),
  };
}

/* ───────────────────── ХЕЛПЕРИ СПЛІТУ ───────────────────── */

/** Пошук безпечного розрізу для plain/Markdown: \n, далі пробіл, інакше жорстко. */
function findSoftCut(s, limit, minSoft = 400) {
  let cut = s.lastIndexOf("\n", limit);
  if (cut < 0 || cut < limit - minSoft) cut = s.lastIndexOf(" ", limit);
  if (cut < 0 || cut < limit - minSoft) cut = limit;
  return cut;
}

/** Примітивний сканер HTML, щоб не різати всередині тегу. */
function findHtmlSafeCut(s, limit, minSoft = 200) {
  // шукаємо позицію <= limit, де не всередині <...>
  let inTag = false, quote = null;
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inTag) {
      if (ch === "<") { inTag = true; quote = null; }
      // запам'ятовуємо "приємні" місця різу
      if (i <= limit) {
        if (s[i] === "\n") lastSafe = i;
        else if (s[i] === " ") lastSafe = Math.max(lastSafe, i);
      }
    } else {
      if (quote) {
        // вихід з лапок
        if (ch === quote) quote = null;
      } else {
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") inTag = false;
      }
    }
    if (i === limit) break;
  }
  // якщо останній safe занадто далеко, повертаємось до plain-логіки
  if (lastSafe < 0 || lastSafe < limit - minSoft) lastSafe = limit;
  return lastSafe;
}

/** Спліт Markdown з повагою до ```кодблоків```; дуже довгі блоки — ріжемо з повторними огорожами. */
function splitMarkdownSmart(text, maxLen = 3900) {
  const s = String(text || "");
  if (s.length <= maxLen) return [s];

  const fenceRx = /```([a-z0-9_+\-.]*)\s*([\s\S]*?)```/gi;
  const parts = [];
  let last = 0, m;

  while ((m = fenceRx.exec(s)) != null) {
    const before = s.slice(last, m.index);
    if (before) parts.push({ type: "text", body: before });
    const lang = m[1] || "";
    const body = m[2] || "";
    parts.push({ type: "code", lang, body });
    last = fenceRx.lastIndex;
  }
  if (last < s.length) parts.push({ type: "text", body: s.slice(last) });

  const out = [];
  let buf = "";

  function flush(force = false) {
    if (!buf) return;
    if (force || buf.length >= maxLen) {
      // нарізаємо buf на «мʼяких» межах
      let rest = buf;
      while (rest.length > maxLen) {
        const cut = findSoftCut(rest, maxLen);
        out.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
      }
      if (rest) out.push(rest);
      buf = "";
    }
  }

  for (const p of parts) {
    if (p.type === "text") {
      // додаємо текст до буфера
      if ((buf + p.body).length > maxLen) flush(true);
      buf += (buf ? "" : "") + p.body;
      if (buf.length > maxLen) flush(true);
    } else {
      // code-блок: спочатку виштовхнемо буфер
      flush(true);
      const full = "```" + (p.lang || "") + "\n" + p.body + "\n```";
      if (full.length <= maxLen) {
        out.push(full);
      } else {
        // дуже великий блок — ріжемо усередині, огортаємо кожен шматок окремими ```
        let rest = p.body;
        while (rest.length) {
          // намагаємось різати по новому рядку
          const sliceLimit = Math.max(100, maxLen - 16 - (p.lang ? p.lang.length : 0));
          let cut = rest.lastIndexOf("\n", sliceLimit);
          if (cut < 0 || cut < sliceLimit * 0.6) cut = sliceLimit;
          const chunk = rest.slice(0, cut);
          out.push("```" + (p.lang || "") + "\n" + chunk + "\n```");
          rest = rest.slice(cut).replace(/^\s+/, "");
        }
      }
    }
  }
  flush(true);
  return out;
}

/** Загальний спліттер: обирає режим на основі parse_mode та наявності ``` */
function splitForTelegramSmart(text = "", parse_mode) {
  const s = String(text || "");
  const hardMax = parse_mode ? 1000 : 3900; // запас від офіційних 1024/4096
  if (!s) return [""];
  // Markdown з кодблоками
  if (!parse_mode && s.includes("```")) {
    const mdChunks = splitMarkdownSmart(s, 3900);
    // перестраховка: якщо раптом якийсь > 3900 — розріжемо plain-логікою
    const repaired = [];
    for (const c of mdChunks) {
      if (c.length <= 3900) repaired.push(c);
      else {
        let rest = c;
        while (rest.length) {
          const cut = findSoftCut(rest, 3900);
          repaired.push(rest.slice(0, cut).trimEnd());
          rest = rest.slice(cut).trimStart();
        }
      }
    }
    return repaired;
  }

  // HTML: не ріжемо в середині тегів
  if (parse_mode === "HTML") {
    if (s.length <= 1000) return [s];
    const chunks = [];
    let rest = s;
    while (rest.length) {
      if (rest.length <= 1000) { chunks.push(rest); break; }
      const cut = findHtmlSafeCut(rest, 1000, 200);
      chunks.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    return chunks;
  }

  // MarkdownV2 або plain без кодблоків
  const limit = parse_mode === "MarkdownV2" ? 1000 : 3900;
  if (s.length <= limit) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length) {
    if (rest.length <= limit) { chunks.push(rest); break; }
    const cut = findSoftCut(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return chunks;
}
/* ───────────────────── ВІДПРАВКА ТЕКСТУ ───────────
   - Авто-спліт на серію повідомлень (Markdown/HTML-safe).
   - reply_markup додається тільки до ПЕРШОГО повідомлення.
*/
export async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const chunks = splitForTelegramSmart(text, extra?.parse_mode);

  for (let i = 0; i < chunks.length; i++) {
    const body = {
      chat_id: chatId,
      text: chunks[i],
      disable_web_page_preview: true,
    };
    // parse_mode: даємо кожному шматку, бо ми вже розрізали безпечно для обраного режиму
    if (extra.parse_mode) body.parse_mode = extra.parse_mode;
    // клавіатура — лише у першому шматку (щоб не дублювати)
    if (i === 0 && extra.reply_markup) body.reply_markup = extra.reply_markup;

    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // тихий фейл — не валимо увесь флоу
    }
  }
}

/* ──────────────── ДІЇ ЧАТУ (typing/uploading) ───── */
export async function sendChatAction(env, chatId, action = "typing") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendChatAction`;
  const body = { chat_id: chatId, action };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {}
}

/** Обгортач: увімкнути "друкує…" на час довгої операції */
export async function withTyping(env, chatId, fn, { pingMs = 4000 } = {}) {
  let alive = true;
  sendChatAction(env, chatId, "typing").catch(()=>{});
  const timer = setInterval(() => {
    if (!alive) return clearInterval(timer);
    sendChatAction(env, chatId, "typing").catch(()=>{});
  }, Math.max(2000, pingMs));
  try {
    return await fn();
  } finally {
    alive = false;
    clearInterval(timer);
  }
}

/** Обгортач: індикатор “йде завантаження…” */
export async function withUploading(env, chatId, fn, { action = "upload_document", pingMs = 4000 } = {}) {
  let alive = true;
  sendChatAction(env, chatId, action).catch(()=>{});
  const timer = setInterval(() => {
    if (!alive) return clearInterval(timer);
    sendChatAction(env, chatId, action).catch(()=>{});
  }, Math.max(2000, pingMs));
  try {
    return await fn();
  } finally {
    alive = false;
    clearInterval(timer);
  }
}
/* ───────────── Спінер через редагування повідомлення ────────────
   (опційно; дає UX на кшталт GPT — "Думаю…" з крапками)
*/
export async function startSpinner(env, chatId, base = "Думаю над відповіддю") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;

  async function send(text) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      const j = await r.json().catch(()=>null);
      return j?.result?.message_id || null;
    } catch { return null; }
  }

  async function edit(message_id, text) {
    if (!message_id) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id, text })
      });
    } catch {}
  }

  const messageId = await send(base + "…");
  if (!messageId) return { stop: async () => {} };

  let i = 0, alive = true;
  const dots = ["", ".", "..", "..."];
  const timer = setInterval(() => {
    if (!alive) return clearInterval(timer);
    i = (i + 1) % dots.length;
    edit(messageId, base + dots[i]);
  }, 1200);

  return {
    stop: async (finalText) => {
      alive = false; clearInterval(timer);
      if (finalText) await edit(messageId, finalText);
      else await edit(messageId, "Готово");
    }
  };
}

/* ───────────────────── Розбір /ai ────────────────── */
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

/* ─────────────────── Експорт one-stop TG ─────────── */
export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  BTN_CODE,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  parseAiCommand,
  askLocationKeyboard,
  // індикатори
  sendChatAction,
  withTyping,
  withUploading,
  startSpinner,
};
 
