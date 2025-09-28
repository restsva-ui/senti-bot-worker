import { sendMessage } from "../utils/telegram";
import type { Env } from "../index";
import type { TgUpdate } from "../types";

const WIKI_API = "https://uk.wikipedia.org/api/rest_v1/page/summary/";

// Витягуємо запит після /wiki
function extractQuery(text: string | undefined): string {
  if (!text) return "";
  const m = text.match(/^\/wiki(?:@\w+)?\s+(.+)$/i);
  return (m?.[1] ?? "").trim();
}

async function fetchWikiSummary(q: string): Promise<string | null> {
  const slug = encodeURIComponent(q);
  const r = await fetch(`${WIKI_API}${slug}`);
  if (!r.ok) return null;
  const data = await r.json<any>().catch(() => null);
  const title = data?.title;
  const extract = data?.extract;
  if (!title || !extract) return null;
  return `📚 <b>${title}</b>\n\n${extract}`;
}

export async function cmdWiki(env: Env, update: TgUpdate) {
  if (!update.message) return;
  const chatId = update.message.chat.id;
  const q = extractQuery(update.message.text);

  if (!q) {
    await sendMessage(env, chatId, "ℹ️ Використання: <code>/wiki &lt;запит&gt;</code>\nНапр.: <code>/wiki Київ</code>");
    return;
  }

  const text = await fetchWikiSummary(q);
  if (!text) {
    await sendMessage(env, chatId, "Не вдалося отримати дані з Вікіпедії. Спробуй інший запит.");
    return;
  }
  await sendMessage(env, chatId, text);
}

export const wikiCommand = {
  name: "wiki",
  description: "Коротка довідка з Вікіпедії",
  execute: cmdWiki,
};