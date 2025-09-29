// src/commands/wiki.ts
import type { TgUpdate } from "../types";

type EnvBase = { BOT_TOKEN: string; API_BASE_URL?: string };

export const wikiCommand = {
  name: "wiki",
  description: "Пошук стислої довідки у Вікіпедії",
  async execute(env: EnvBase, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text ?? "";
    if (!chatId) return;

    const query = text.replace(/^\/wiki(?:@\w+)?/i, "").trim();
    if (!query) {
      await sendMessage(env, chatId, "Використання: <code>/wiki Київ</code>", { parse_mode: "HTML" });
      return;
    }

    const result =
      (await wikiSearch("uk", query)) ||
      (await wikiSearch("en", query));

    if (!result) {
      await sendMessage(env, chatId, `Нічого не знайшов за запитом: <b>${escapeHtml(query)}</b>`, {
        parse_mode: "HTML",
      });
      return;
    }

    const { title, extract, url } = result;
    const reply = `<b>${escapeHtml(title)}</b>\n${escapeHtml(extract)}`;
    const keyboard = { inline_keyboard: [[{ text: "🔗 Відкрити у Вікіпедії", url }]] };

    await sendMessage(env, chatId, reply, { parse_mode: "HTML", reply_markup: keyboard });
  },
} as const;

/* -------------------- Wikipedia OpenSearch -------------------- */
async function wikiSearch(lang: "uk" | "en", query: string) {
  try {
    const enc = encodeURIComponent(query);
    const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=${enc}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j: any = await res.json();
    const [_, titles, extracts, links] = j;
    if (!titles?.length) return null;

    return {
      title: titles[0],
      extract: extracts[0] || "Без опису",
      url: links[0] || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(titles[0])}`,
    };
  } catch {
    return null;
  }
}

/* -------------------- Telegram -------------------- */
async function sendMessage(
  env: EnvBase,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })
    .catch(() => null);
}

/* -------------------- Utils -------------------- */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}