// src/commands/wiki.ts
import type { TgUpdate } from "../types";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string };
const WIKI_PROMPT = "✍️ Введіть запит для Wiki у наступному повідомленні (відповіддю).";
const SUPPORTED = ["uk", "ru", "en", "de", "fr"] as const;
type Lang = typeof SUPPORTED[number];

function apiBase(env: Env) {
  return env.API_BASE_URL || "https://api.telegram.org";
}

async function tg(env: Env, method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${apiBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? res.json().catch(() => ({})) : {};
}

function parseArgs(raw: string): { lang: Lang; query: string } {
  // /wiki [lang] <query>
  const parts = raw.trim().split(/\s+/);
  let lang: Lang = "uk";
  if (parts.length > 1 && SUPPORTED.includes(parts[1] as Lang)) {
    lang = parts[1] as Lang;
    return { lang, query: parts.slice(2).join(" ").trim() };
  }
  return { lang, query: parts.slice(1).join(" ").trim() };
}

async function fetchWikiExtract(lang: Lang, query: string): Promise<string | null> {
  if (!query) return null;
  const endpoint =
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/` +
    encodeURIComponent(query);

  const r = await fetch(endpoint, { cf: { cacheTtl: 300, cacheEverything: true } as any });
  if (!r.ok) return null;

  const data: any = await r.json().catch(() => null);
  if (!data) return null;

  // у Summary є поля title, extract, description
  const title = data.title || query;
  const extract = data.extract || "";
  if (!extract) return null;

  // обрізаємо дуже довгі тексти, щоби не спамити чат
  const MAX = 1500;
  const text = extract.length > MAX ? extract.slice(0, MAX - 1) + "…" : extract;
  return `🔎 <b>Wiki (${lang})</b>\n<b>Запит:</b> ${title}\n\n${text}`;
}

/** Коли користувач вводить /wiki (без аргументів) — показуємо ForceReply */
export const wikiCommand = {
  name: "wiki",
  description: "Пошук стислої довідки у Вікіпедії (uk/ru/en/de/fr)",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text || "";

    const { lang, query } = parseArgs(text);
    if (!chatId) return;

    // якщо є запит одразу — шукаємо
    if (query) {
      const result = await fetchWikiExtract(lang, query);
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: result ?? `Нічого не знайшов за запитом: <b>${query}</b>`,
        parse_mode: "HTML",
      });
      return;
    }

    // інакше просимо ввести запит у наступному повідомленні
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: WIKI_PROMPT,
      reply_markup: { force_reply: true, selective: true },
    });
  },
} as const;

/** Обробник відповіді на ForceReply від /wiki */
export async function wikiHandleReply(env: Env, update: TgUpdate) {
  const msg = update.message;
  if (!msg?.reply_to_message?.text?.includes(WIKI_PROMPT)) return false;

  const chatId = msg.chat.id;
  let text = (msg.text || "").trim();
  if (!text) return true;

  // дозволяємо формат: "<lang> <query>" або просто "<query>"
  const first = text.split(/\s+/, 1)[0]!;
  let lang: Lang = SUPPORTED.includes(first as Lang) ? (first as Lang) : "uk";
  if (lang !== "uk") text = text.slice(first.length).trim();

  const result = await fetchWikiExtract(lang, text);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: result ?? `Нічого не знайшов за запитом: <b>${text}</b>`,
    parse_mode: "HTML",
  });
  return true;
}