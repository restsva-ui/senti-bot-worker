// src/commands/wiki.ts
import type { Env } from "../types";

const STATE_KEY = (chatId: number) => `wiki:await:${chatId}`;
const PROMPT_TEXT = "✍️ Введіть запит для Wiki у наступному повідомленні (відповіддю).";

const SUPPORTED = ["uk", "ru", "en", "de", "fr"] as const;
type Lang = (typeof SUPPORTED)[number];

function detectLang(q: string): Lang {
  const s = q.toLowerCase();
  // дуже простий і надійний детектор
  if (/[ґєії]/i.test(s)) return "uk";
  if (/[ёыэъ]/i.test(s)) return "ru";
  // можна розширити, але для стабільності так достатньо
  return "en";
}

async function wikiSummary(lang: Lang, title: string) {
  const base = `https://${lang}.wikipedia.org`;
  // 1) пряма спроба summary (з редіректами)
  const r1 = await fetch(
    `${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
    { headers: { "User-Agent": "SentiBot/1.0 (+https://t.me/senti_helper_bot)" } }
  );
  if (r1.ok) return await r1.json<any>();

  // 2) opensearch -> перший хіт -> summary
  const r2 = await fetch(
    `${base}/w/api.php?action=opensearch&search=${encodeURIComponent(title)}&limit=1&namespace=0&format=json`,
    { headers: { "User-Agent": "SentiBot/1.0 (+https://t.me/senti_helper_bot)" } }
  );
  if (!r2.ok) return null;

  const arr = await r2.json<any[]>();
  const first = Array.isArray(arr) && Array.isArray(arr[1]) && arr[1][0];
  if (!first) return null;

  const r3 = await fetch(
    `${base}/api/rest_v1/page/summary/${encodeURIComponent(first)}?redirect=true`,
    { headers: { "User-Agent": "SentiBot/1.0 (+https://t.me/senti_helper_bot)" } }
  );
  if (!r3.ok) return null;
  return await r3.json<any>();
}

function buildAnswer(sum: any): { text: string } | null {
  if (!sum || !sum.title || !sum.extract || !sum.content_urls?.desktop?.page) return null;
  const url = sum.content_urls.desktop.page;
  const title = sum.title;
  const extract = sum.extract.length > 900 ? sum.extract.slice(0, 900) + "…" : sum.extract;
  const text =
    `📚 <b>${escapeHtml(title)}</b>\n\n` +
    `${escapeHtml(extract)}\n\n` +
    `🔗 <a href="${url}">${url}</a>`;
  return { text };
}

function escapeHtml(s: string) {
  return s.replace(/[<&>"']/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[m]!));
}

// === ПУБЛІЧНІ ХЕНДЛЕРИ ===============================================

export async function wikiCommand(update: any, env: Env) {
  const msg = update.message;
  const chatId = msg.chat.id as number;
  const text: string = msg.text || "";

  // патерн: /wiki [lang]? [query]?  | приклади: "/wiki Київ", "/wiki en Vienna"
  const m = text.match(/^\/wiki(?:@[\w_]+)?(?:\s+([a-z]{2}))?(?:\s+(.+))?$/i);
  const langRaw = (m?.[1] || "").toLowerCase();
  const qRaw = (m?.[2] || "").trim();

  // якщо немає запиту — ставимо очікування і просимо ввести
  if (!qRaw) {
    await env.LIKES_KV.put(STATE_KEY(chatId), "1", { expirationTtl: 300 });
    await tgSend(env, chatId, PROMPT_TEXT, { reply_to_message_id: msg.message_id });
    return true;
  }

  const lang: Lang = (SUPPORTED as readonly string[]).includes(langRaw) ? (langRaw as Lang) : detectLang(qRaw);
  const summary = await wikiSummary(lang, qRaw);
  const ans = buildAnswer(summary);

  if (!ans) {
    await tgSend(env, chatId, `Нічого не знайшов за запитом: <b>${escapeHtml(qRaw)}</b> (${lang}).`, { parse_mode: "HTML" });
    return true;
  }

  await tgSend(env, chatId, ans.text, { parse_mode: "HTML", disable_web_page_preview: false });
  return true;
}

/**
 * Обробка вільного тексту після /wiki:
 * - якщо є активний стан у KV, або
 * - якщо це reply на наше системне повідомлення з підказкою
 */
export async function wikiMaybeHandleFreeText(update: any, env: Env) {
  const msg = update.message;
  if (!msg || !msg.text || msg.entities) return false; // пропускаємо команди/форматоване

  const chatId = msg.chat.id as number;

  // 1) активний стан?
  const awaiting = await env.LIKES_KV.get(STATE_KEY(chatId));
  // 2) або це реплай на нашу підказку?
  const isReplyToPrompt =
    !!msg.reply_to_message &&
    typeof msg.reply_to_message.text === "string" &&
    msg.reply_to_message.text.startsWith("✍️ Введіть запит для Wiki");

  if (!awaiting && !isReplyToPrompt) return false;

  // гасимо стан
  await env.LIKES_KV.delete(STATE_KEY(chatId));

  const q = msg.text.trim();
  const lang = detectLang(q);

  const summary = await wikiSummary(lang, q);
  const ans = buildAnswer(summary);

  if (!ans) {
    await tgSend(env, chatId, `Нічого не знайшов за запитом: <b>${escapeHtml(q)}</b> (${lang}).`, { parse_mode: "HTML" });
    return true;
  }

  await tgSend(env, chatId, ans.text, { parse_mode: "HTML", disable_web_page_preview: false });
  return true;
}

// === Telegram send helper =============================================

async function tgSend(env: Env, chatId: number, text: string, extra?: Record<string, any>) {
  const body = { chat_id: chatId, text, ...extra };
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}