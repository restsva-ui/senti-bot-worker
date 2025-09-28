// src/commands/wiki.ts
import type { Env } from "../index";
import { sendMessage } from "../utils/telegram";

type TgUser = { language_code?: string };
type TgChat = { id: number };
type TgMessage = { text?: string; chat: TgChat; from?: TgUser };
type TgUpdate = { message?: TgMessage };

function getQuery(msg?: TgMessage): string | null {
  const t = msg?.text ?? "";
  // команду очікуємо як: /wiki <запит>
  const m = t.match(/^\/wiki(@\w+)?\s+(.+)$/i);
  return m?.[2]?.trim() || null;
}

function langFrom(update: TgUpdate): string {
  const lc = update.message?.from?.language_code?.toLowerCase() || "en";
  // підтримуємо uk/ru/en/es/de/fr/it/pl; інакше en
  if (/^(uk|ru|en|es|de|fr|it|pl)$/.test(lc)) return lc.slice(0, 2);
  return "en";
}

async function wikiSummary(lang: string, title: string) {
  const base = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/`;
  const url = base + encodeURIComponent(title) + "?redirect=true";
  const res = await fetch(url, { headers: { "User-Agent": "SentiBot/1.0" } });
  if (!res.ok) return null;
  const data = await res.json<any>();
  if (!data?.extract || data?.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found")
    return null;
  return {
    title: data.title as string,
    extract: (data.extract as string).trim(),
    url: (data.content_urls?.desktop?.page as string) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
  };
}

export async function cmdWiki(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  const q = getQuery(update.message);

  if (!q) {
    await sendMessage(
      env,
      chatId,
      "Використання: `/wiki <запит>`\nНапр.: `/wiki Київ`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const lang = langFrom(update);
  let info = await wikiSummary(lang, q);
  if (!info && lang !== "en") info = await wikiSummary("en", q);

  if (!info) {
    await sendMessage(env, chatId, "Нічого не знайдено 🙈");
    return;
  }

  const text =
    `*${escapeMd(info.title)}*\n` +
    `${escapeMd(info.extract)}\n` +
    `\n[Відкрити у Вікіпедії](${info.url})`;

  await sendMessage(env, chatId, text, { parse_mode: "Markdown", disable_web_page_preview: false });
}

// простенький ескейп для Markdown V2/звичайного Markdown
function escapeMd(s: string) {
  return s.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}