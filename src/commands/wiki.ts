// src/commands/wiki.ts
import { tgSendMessage } from "../utils/telegram";
import { normalizeLang, type Lang } from "../utils/i18n";
import type { Env as RootEnv } from "../index";

/** У .env/wrangler повинен бути SENTI_CACHE (KV). Якщо його нема — падати не будемо. */
type Env = RootEnv & {
  SENTI_CACHE?: KVNamespace;
};

type WikiState = {
  topic?: string;
  subtopic?: string;
  ts: number;
};

const STATE_TTL = 60 * 15; // 15 хвилин

// ===================== helpers =====================

function wikiHostByLang(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "uk.wikipedia.org";
    case "ru":
      return "ru.wikipedia.org";
    case "de":
      return "de.wikipedia.org";
    default:
      return "en.wikipedia.org";
  }
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tgHtml(text: string): string {
  // Перетворюємо прості <br/> на \n, прибираємо зайвий HTML, залишаємо тільки <b>, <i>, <a>
  // (на вхід зазвичай вже чиста plain-строка).
  return text.replace(/\r?\n/g, "\n");
}

async function kvGet(env: Env, key: string): Promise<WikiState | null> {
  if (!env.SENTI_CACHE) return null;
  try {
    const raw = await env.SENTI_CACHE.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvSet(env: Env, key: string, val: WikiState, ttlSec = STATE_TTL) {
  if (!env.SENTI_CACHE) return;
  try {
    await env.SENTI_CACHE.put(key, JSON.stringify(val), { expirationTtl: ttlSec });
  } catch {
    // ignore
  }
}

async function kvDel(env: Env, key: string) {
  if (!env.SENTI_CACHE) return;
  try {
    await env.SENTI_CACHE.delete(key);
  } catch {
    // ignore
  }
}

function stateKey(chatId: number) {
  return `wiki:state:${chatId}`;
}

function buildExitKeyboard() {
  return {
    inline_keyboard: [[{ text: "❌ Вийти з вікі", callback_data: "wiki:exit" }]],
  };
}

// ===================== Wikipedia API =====================

async function fetchSummaryByTitle(title: string, lang: Lang): Promise<{ ok: boolean; title?: string; extract?: string; url?: string; }>{
  const host = wikiHostByLang(lang);
  const u = `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
  const res = await fetch(u, { cf: { cacheTtl: 300 }, headers: { "accept": "application/json" } });
  if (!res.ok) return { ok: false };
  const data = await res.json<any>();
  if (!data?.title || !data?.extract) return { ok: false };
  const pageUrl = data?.content_urls?.desktop?.page || `https://${host}/wiki/${encodeURIComponent(data.title)}`;
  return { ok: true, title: data.title, extract: data.extract, url: pageUrl };
}

async function searchBest(title: string, lang: Lang): Promise<string | null> {
  const host = wikiHostByLang(lang);
  const u = `https://${host}/w/api.php?action=opensearch&search=${encodeURIComponent(title)}&limit=1&namespace=0&format=json`;
  const res = await fetch(u, { cf: { cacheTtl: 300 } });
  if (!res.ok) return null;
  const arr = await res.json<any[]>();
  const best = arr?.[1]?.[0];
  return typeof best === "string" && best.trim() ? best : null;
}

async function resolveSummary(query: string, lang: Lang) {
  // 1) пробуємо точну сторінку
  let s = await fetchSummaryByTitle(query, lang);
  if (s.ok) return s;

  // 2) шукаємо кращий збіг
  const best = await searchBest(query, lang);
  if (best) {
    s = await fetchSummaryByTitle(best, lang);
    if (s.ok) return s;
  }
  return { ok: false as const };
}

function formatAnswer(title: string, extract: string, url: string): string {
  const hTitle = escapeHtml(title);
  const hExtract = escapeHtml(extract);
  const hUrl = escapeHtml(url);
  const text =
    `📚 <b>${hTitle}</b>\n\n` +
    `${hExtract}\n\n` +
    `🔗 <a href="${hUrl}">Відкрити у Вікіпедії</a>`;
  return tgHtml(text);
}

// ===================== Public commands/handlers =====================

/**
 * /wiki або /wiki <термін>
 * Якщо термін передано — одразу ставимо state.topic і просимо уточнення.
 * Якщо ні — просто вмикаємо режим і просимо написати термін.
 */
export async function wiki(ctx: { env: Env }, args?: { message?: any }) {
  const env = ctx.env;
  const chatId: number | undefined = args?.message?.chat?.id;
  if (!chatId) return;

  const text: string = (args?.message?.text ?? "").trim();
  const lang: Lang = normalizeLang(args?.message?.from?.language_code);

  const m = text.match(/^\/wiki(?:@\w+)?\s*(.*)$/i);
  const passed = (m?.[1] || "").trim();

  if (passed) {
    // збережемо state і попросимо уточнення
    await kvSet(env, stateKey(chatId), { topic: passed, ts: Date.now() });
    await tgSendMessage(env as any, chatId,
      `Увімкнено вікі-режим для теми: <b>${escapeHtml(passed)}</b>.\nНапиши, що саме цікавить (наприклад: «населення», «історія», «економіка»).`,
      { parse_mode: "HTML", reply_markup: buildExitKeyboard() }
    );
    return;
  }

  // просто увімкнути режим очікування терміну
  await kvSet(env, stateKey(chatId), { ts: Date.now() });
  await tgSendMessage(env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇",
    { reply_markup: buildExitKeyboard() });
}

/** Примусово увімкнути очікування терміну (викликається з index.ts при /wiki без аргументів) */
export async function wikiSetAwait(ctx: { env: Env }, update: any) {
  const env = ctx.env;
  const chatId: number | undefined = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
  if (!chatId) return;
  await kvSet(env, stateKey(chatId), { ts: Date.now() });
  await tgSendMessage(env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇",
    { reply_markup: buildExitKeyboard() });
}

/**
 * Перехоплення довільного тексту, коли увімкнено wiki-state.
 * Працює так:
 *  - якщо topic ще нема → це topic;
 *  - якщо topic вже є → це subtopic (уточнення). Пробуємо знайти сторінку по “topic + subtopic”.
 */
export async function wikiMaybeHandleFreeText(ctx: { env: Env }, update: any): Promise<boolean> {
  const env = ctx.env;
  const msg = update?.message;
  if (!msg?.text || msg.text.startsWith("/")) return false;

  const chatId: number | undefined = msg?.chat?.id;
  if (!chatId) return false;

  const stKey = stateKey(chatId);
  const st = await kvGet(env, stKey);
  if (!st) return false; // вікі-режим не увімкнено

  const lang: Lang = normalizeLang(msg?.from?.language_code);
  const text = msg.text.trim();

  // Вихід із вікі (на випадок, якщо користувач напише руками)
  if (/^(вийти|вихід|exit|quit)$/i.test(text)) {
    await kvDel(env, stKey);
    await tgSendMessage(env as any, chatId, "Вікі-режим вимкнено.");
    return true;
  }

  let topic = st.topic;
  let subtopic = st.subtopic;

  if (!topic) {
    // перше повідомлення — це тема
    topic = text;
    await kvSet(env, stKey, { topic, ts: Date.now() });
    await tgSendMessage(env as any, chatId, `Що саме про <b>${escapeHtml(topic)}</b> цікавить?`,
      { parse_mode: "HTML", reply_markup: buildExitKeyboard() });
    return true;
  }

  // тут topic уже є — сприймаємо як уточнення
  subtopic = text;
  await kvSet(env, stKey, { topic, subtopic, ts: Date.now() });

  // спробуємо знайти сторінку за уточненим запитом
  const combined = `${topic} ${subtopic}`.trim();
  let res = await resolveSummary(combined, lang);
  if (!res.ok) {
    // fallback: віддати загальний summary за topic
    res = await resolveSummary(topic, lang);
  }

  if (res.ok && res.title && res.extract && res.url) {
    const prefix = subtopic
      ? `🔎 Запит: <b>${escapeHtml(subtopic)}</b>\n\n`
      : "";
    await tgSendMessage(env as any, chatId, prefix + formatAnswer(res.title, res.extract, res.url),
      { parse_mode: "HTML", reply_markup: buildExitKeyboard() });
  } else {
    await tgSendMessage(env as any, chatId, "Не знайшов сторінку у Вікіпедії.",
      { reply_markup: buildExitKeyboard() });
  }

  return true;
}

// ===================== Callback-події (опційно) =====================

/** Обробка callback-кнопок від wiki (поки одна — вихід) */
export async function wikiOnCallback(env: Env, update: any) {
  const data = update?.callback_query?.data;
  const chatId = update?.callback_query?.message?.chat?.id;
  if (!chatId || !data) return;

  if (data === "wiki:exit") {
    await kvDel(env, stateKey(chatId));
    await tgSendMessage(env as any, chatId, "Вікі-режим вимкнено.");
  }
}