// src/commands/wiki.ts
import type { TgUpdate } from "../types";

type EnvBase = { BOT_TOKEN: string; API_BASE_URL?: string };

/**
 * /wiki <запит>
 * 1) Пробуємо знайти статтю в укр-вікі, далі fallback в англ-вікі.
 * 2) Віддаємо короткий опис (summary) + посилання кнопкою.
 */
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

    // 1) Пошук в укр-вікі, далі — англ-вікі
    const result =
      (await fetchSummary("uk", query)) ||
      (await searchAndFetch("uk", query)) ||
      (await fetchSummary("en", query)) ||
      (await searchAndFetch("en", query));

    if (!result) {
      await sendMessage(env, chatId, `Нічого не знайшов за запитом: <b>${escapeHtml(query)}</b>`, {
        parse_mode: "HTML",
      });
      return;
    }

    const { title, extract, url } = result;

    // підрізаємо відповідь, щоб не перевищувати ліміт Telegram (4096 символів)
    const MAX = 1200;
    const short = extract.length > MAX ? extract.slice(0, MAX - 1) + "…" : extract;

    const reply = `<b>${escapeHtml(title)}</b>\n${escapeHtml(short)}`;
    const keyboard = {
      inline_keyboard: [[{ text: "🔗 Відкрити у Вікіпедії", url }]],
    };

    await sendMessage(env, chatId, reply, { parse_mode: "HTML", reply_markup: keyboard });
  },
} as const;

/* ===================== Wikipedia helpers ===================== */

/** Пряма спроба взяти summary за назвою сторінки */
async function fetchSummary(lang: "uk" | "en", title: string) {
  try {
    const enc = encodeURIComponent(title);
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`;
    const res = await fetch(url, { headers: { "accept": "application/json" } });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j?.title || !j?.extract || j?.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found") {
      return null;
    }
    return {
      title: j.title as string,
      extract: String(j.extract),
      url: (j.content_urls?.desktop?.page as string) || `https://${lang}.wikipedia.org/wiki/${enc}`,
    };
  } catch {
    return null;
  }
}

/** Пошук назви й потім summary */
async function searchAndFetch(lang: "uk" | "en", q: string) {
  try {
    const enc = encodeURIComponent(q);
    // Відносно новий REST-пошук
    const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${enc}&limit=1`;
    const res = await fetch(url, { headers: { "accept": "application/json" } });
    if (!res.ok) return null;
    const j: any = await res.json();
    const title: string | undefined = j?.pages?.[0]?.title;
    if (!title) return null;
    return await fetchSummary(lang, title);
  } catch {
    return null;
  }
}

/* ===================== Telegram low-level ===================== */

async function sendMessage(
  env: EnvBase,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}

/* ===================== utils ===================== */

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}