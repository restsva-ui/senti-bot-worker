// src/commands/wiki.ts
import { tgSendMessage } from "../utils/telegram";
import type { Env } from "../index";
import { normalizeLang, type Lang } from "../utils/i18n";

type WikiState =
  | { step: "await_topic" }
  | { step: "await_question"; topic: string; lang: Lang };

const WIKI_TTL = 60 * 30; // 30 хв
const key = (chatId: number) => `wiki:${chatId}`;

function kv(env: Env): KVNamespace | undefined {
  return (env as any).SENTI_CACHE as KVNamespace | undefined;
}
async function readState(env: Env, chatId: number) {
  try { return await kv(env)?.get(key(chatId), "json") as WikiState | null; } catch { return null; }
}
async function writeState(env: Env, chatId: number, state: WikiState) {
  await kv(env)?.put(key(chatId), JSON.stringify(state), { expirationTtl: WIKI_TTL });
}
async function clearState(env: Env, chatId: number) {
  await kv(env)?.delete(key(chatId));
}

function wikiDomain(lang: Lang) {
  return lang === "uk" ? "uk.wikipedia.org"
       : lang === "ru" ? "ru.wikipedia.org"
       : lang === "de" ? "de.wikipedia.org"
       : "en.wikipedia.org";
}

const baseHeaders = (lang: Lang) => ({
  "accept": "application/json",
  "user-agent": "SentiBot/1.0 (+https://senti-bot-worker.restsva.workers.dev/health)",
  "accept-language": lang
});

/** Повертає summary для терміну з вибраної вікі або null */
async function fetchSummary(lang: Lang, title: string) {
  const domains = [wikiDomain(lang), "en.wikipedia.org"]; // fallback на EN
  const wanted = title.trim();
  const encPage = encodeURIComponent(wanted.replace(/\s+/g, "_"));

  for (const domain of domains) {
    // 1) пряма сторінка
    let url = `https://${domain}/api/rest_v1/page/summary/${encPage}`;
    let res = await fetch(url, { headers: baseHeaders(lang) });
    if (res.ok) return { json: await res.json(), url, domain };

    // 2) пошук першого title
    const search = `https://${domain}/w/rest.php/v1/search/title?q=${encodeURIComponent(wanted)}&limit=1`;
    const sRes = await fetch(search, { headers: baseHeaders(lang) });
    if (sRes.ok) {
      const j = await sRes.json();
      const key = j?.pages?.[0]?.key as string | undefined;
      if (key) {
        url = `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(key)}`;
        res = await fetch(url, { headers: baseHeaders(lang) });
        if (res.ok) return { json: await res.json(), url, domain };
      }
    }
  }
  return null;
}

function htmlAnswer(summary: any, fallbackTitle: string) {
  const title = summary?.title || fallbackTitle;
  const extract = summary?.extract || "Нічого не знайшов у Вікіпедії.";
  const url =
    summary?.content_urls?.desktop?.page ||
    summary?.uri ||
    summary?.url ||
    "";
  // HTML щоб не екранити підкреслення
  return `📚 <b>${title}</b><br/><br/>${extract}<br/><br/>🔗 <a href="${url}">Відкрити у Вікіпедії</a>`;
}

// ============== Публічні API, які використовує index.ts =================

export async function wikiSetAwait(ctx: { env: Env }, update: any) {
  const chatId: number | undefined =
    update?.message?.chat?.id ||
    update?.edited_message?.chat?.id ||
    update?.callback_query?.message?.chat?.id;
  if (!chatId) return;

  await writeState(ctx.env, chatId, { step: "await_topic" });
  await tgSendMessage(ctx.env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇", {
    reply_markup: { inline_keyboard: [[{ text: "❌ Вийти з вікі", callback_data: "menu:back" }]] }
  });
}

export async function wikiMaybeHandleFreeText(ctx: { env: Env }, update: any): Promise<boolean> {
  const msg = update?.message || update?.edited_message || null;
  const chatId: number | undefined = msg?.chat?.id;
  const text: string | undefined = msg?.text?.trim();
  if (!chatId || !text) return false;

  const state = await readState(ctx.env, chatId);
  if (!state) return false;

  if (/^(exit|вийти|stop|стоп)$/i.test(text)) {
    await clearState(ctx.env, chatId);
    await tgSendMessage(ctx.env as any, chatId, "Вікі-режим вимкнено.");
    return true;
  }

  if (state.step === "await_topic") {
    const lang = normalizeLang(msg?.from?.language_code);
    const topic = text;
    await writeState(ctx.env, chatId, { step: "await_question", topic, lang });
    await tgSendMessage(ctx.env as any, chatId, `Що саме про <b>${topic}</b> цікавить?`, { parse_mode: "HTML" });
    return true;
  }

  if (state.step === "await_question") {
    // На перше уточнення показуємо summary теми (швидка відповідь)
    const sum = await fetchSummary(state.lang ?? "uk", state.topic);
    if (!sum) {
      await tgSendMessage(ctx.env as any, chatId, "Не знайшов сторінку у Вікіпедії.");
      return true;
    }
    const html = htmlAnswer(sum.json, state.topic);
    await tgSendMessage(ctx.env as any, chatId, html, { parse_mode: "HTML" });
    return true;
  }

  return false;
}

/** Підтримка варіанту /wiki <термін> */
export async function wiki(ctx: { env: Env }, chatId: number, raw?: string, lang?: Lang) {
  const term = (raw || "").trim();
  const usedLang = lang ?? "uk";
  if (!term) {
    await writeState(ctx.env, chatId, { step: "await_topic" });
    await tgSendMessage(ctx.env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇");
    return;
  }
  await writeState(ctx.env, chatId, { step: "await_question", topic: term, lang: usedLang });
  const sum = await fetchSummary(usedLang, term);
  if (!sum) {
    await tgSendMessage(ctx.env as any, chatId, "Не знайшов сторінку у Вікіпедії.");
    return;
  }
  const html = htmlAnswer(sum.json, term);
  await tgSendMessage(ctx.env as any, chatId, html, { parse_mode: "HTML" });
}
export default wiki;