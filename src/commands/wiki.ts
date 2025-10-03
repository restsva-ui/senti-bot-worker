// src/commands/wiki.ts
import { tgSendMessage } from "../utils/telegram";
import type { Env } from "../index";
import { normalizeLang, type Lang } from "../utils/i18n";

type WikiState =
  | { step: "await_topic" }
  | { step: "await_question"; topic: string; lang: Lang };

const WIKI_TTL = 60 * 30; // 30 хвилин
const key = (chatId: number) => `wiki:${chatId}`;

function getKV(env: Env): KVNamespace | undefined {
  return (env as any).SENTI_CACHE as KVNamespace | undefined;
}

async function readState(env: Env, chatId: number): Promise<WikiState | null> {
  const kv = getKV(env);
  if (!kv) return null;
  try {
    return (await kv.get(key(chatId), "json")) as WikiState | null;
  } catch {
    return null;
  }
}
async function writeState(env: Env, chatId: number, state: WikiState) {
  const kv = getKV(env);
  if (!kv) return;
  await kv.put(key(chatId), JSON.stringify(state), { expirationTtl: WIKI_TTL });
}
async function clearState(env: Env, chatId: number) {
  const kv = getKV(env);
  if (!kv) return;
  await kv.delete(key(chatId));
}

function pickWikiDomain(lang: Lang): string {
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

async function fetchSummary(lang: Lang, title: string) {
  const domain = pickWikiDomain(lang);
  const enc = encodeURIComponent(title.trim().replace(/\s+/g, "_"));
  // 1) summary за прямою назвою
  let url = `https://${domain}/api/rest_v1/page/summary/${enc}`;
  let res = await fetch(url, { headers: { "accept": "application/json" } });
  if (res.ok) return { json: await res.json(), url };

  // 2) пошук title → перший результат
  const searchUrl = `https://${domain}/w/rest.php/v1/search/title?q=${encodeURIComponent(
    title
  )}&limit=1`;
  const s = await fetch(searchUrl, { headers: { accept: "application/json" } });
  if (s.ok) {
    const j = await s.json();
    const first = j?.pages?.[0]?.key as string | undefined;
    if (first) {
      url = `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(first)}`;
      res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) return { json: await res.json(), url };
    }
  }
  return null;
}

function buildAnswer(summary: any, topic: string, lang: Lang): string {
  const title = summary?.title || topic;
  const extract = summary?.extract || "Нічого не знайшов у Вікіпедії.";
  const url = summary?.content_urls?.desktop?.page || summary?.uri || summary?.url;
  return `📚 *${title}*\n\n${extract}\n\n🔗 ${url ?? ""}`;
}

// ============= Публічні API, які викликає index.ts / registry.ts =============

/** /wiki або натискання кнопки — вмикаємо режим очікування теми */
export async function wikiSetAwait(ctx: { env: Env }, update: any) {
  const chatId: number | undefined =
    update?.message?.chat?.id ||
    update?.edited_message?.chat?.id ||
    update?.callback_query?.message?.chat?.id;
  if (!chatId) return;

  const lang = normalizeLang(
    update?.message?.from?.language_code ||
      update?.edited_message?.from?.language_code ||
      update?.callback_query?.from?.language_code
  );

  await writeState(ctx.env, chatId, { step: "await_topic" });
  await tgSendMessage(ctx.env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇", {
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Вийти з вікі", callback_data: "menu:back" }]],
    },
  });
}

/** Обробка вільного тексту, коли ми у вікі-режимі. Повертає true, якщо перехопили. */
export async function wikiMaybeHandleFreeText(ctx: { env: Env }, update: any): Promise<boolean> {
  const msg = update?.message || update?.edited_message || null;
  const chatId: number | undefined = msg?.chat?.id;
  const text: string | undefined = msg?.text?.trim();
  if (!chatId || !text) return false;

  const state = await readState(ctx.env, chatId);
  if (!state) return false;

  // Вихід з режиму
  if (/^(exit|вийти|stop|стоп)$/i.test(text)) {
    await clearState(ctx.env, chatId);
    await tgSendMessage(ctx.env as any, chatId, "Вікі-режим вимкнено.");
    return true;
  }

  // Крок 1: користувач вводить тему
  if (state.step === "await_topic") {
    const lang = normalizeLang(
      msg?.from?.language_code ||
        update?.edited_message?.from?.language_code ||
        update?.callback_query?.from?.language_code
    );
    const topic = text;
    await writeState(ctx.env, chatId, { step: "await_question", topic, lang });
    await tgSendMessage(ctx.env as any, chatId, `Що саме про *${topic}* цікавить?`, {
      parse_mode: "Markdown",
    });
    return true;
  }

  // Крок 2: маємо topic, користувач ставить запитання
  if (state.step === "await_question") {
    const topic = state.topic;
    const lang = state.lang ?? "uk";
    // На перший запит просто віддаємо summary сторінки про topic.
    // Уточнюючі питання можна ігнорувати — це швидкий варіант без LLM.
    const sum = await fetchSummary(lang, topic);
    if (!sum) {
      await tgSendMessage(ctx.env as any, chatId, "Не знайшов сторінку у Вікіпедії.");
      return true;
    }
    const answer = buildAnswer(sum.json, topic, lang);
    await tgSendMessage(ctx.env as any, chatId, answer, { parse_mode: "Markdown" });
    // режим залишається активним — можна задавати наступні уточнення
    return true;
  }

  return false;
}

/** Повноцінна команда (на випадок, якщо хтось імпортує як /wiki <term>) */
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
  const answer = buildAnswer(sum.json, term, usedLang);
  await tgSendMessage(ctx.env as any, chatId, answer, { parse_mode: "Markdown" });
}
export default wiki;