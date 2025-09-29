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

    // 1) Шукаємо в укр-вікі, якщо порожньо — в англ-вікі
    const first =
      (await searchPage("uk", query)) ||
      (await searchPage("en", query));

    if (!first) {
      await sendMessage(env, chatId, `Нічого не знайшов за запитом: <b>${escapeHtml(query)}</b>`, {
        parse_mode: "HTML",
      });
      return;
    }

    // Є шанс, що excerpt короткий. Спробуємо summary по exact key.
    const summary =
      (await fetchSummary(first.lang, first.key)) ||
      { title: first.title, extract: stripHtml(first.excerpt), url: first.url };

    const MAX = 1200;
    const textOut = [
      `<b>${escapeHtml(summary.title)}</b>`,
      escapeHtml(summary.extract.length > MAX ? summary.extract.slice(0, MAX - 1) + "…" : summary.extract),
    ].join("\n");

    const keyboard = { inline_keyboard: [[{ text: "🔗 Відкрити у Вікіпедії", url: summary.url }]] };
    await sendMessage(env, chatId, textOut, { parse_mode: "HTML", reply_markup: keyboard });
  },
} as const;

/* ===================== Wikipedia helpers ===================== */

/**
 * Новий пошук: /w/rest.php/v1/search/page?q=<q>&limit=1
 * Повертає title, key, excerpt, content_urls
 */
async function searchPage(lang: "uk" | "en", q: string) {
  try {
    const enc = encodeURIComponent(q);
    const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${enc}&limit=1`;
    const res = await fetch(url, {
      headers: {
        "accept": "application/json",
        // Деякі еджи люблять коректний UA
        "user-agent": "SentiBot/1.0 (Cloudflare Worker)",
      },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const page = j?.pages?.[0];
    if (!page?.title || !page?.key) return null;

    const urlOut =
      (page?.content_urls?.desktop?.page as string) ||
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`;

    return {
      lang,
      title: String(page.title),
      key: String(page.key),          // exact page key, без пробілів
      excerpt: String(page.excerpt ?? ""),
      url: urlOut,
    };
  } catch {
    return null;
  }
}

/** Summary по exact key — детальніший текст */
async function fetchSummary(lang: "uk" | "en", key: string) {
  try {
    const encKey = encodeURIComponent(key);
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encKey}`;
    const res = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "SentiBot/1.0 (Cloudflare Worker)",
      },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j?.title || !j?.extract) return null;

    const urlOut =
      (j?.content_urls?.desktop?.page as string) ||
      `https://${lang}.wikipedia.org/wiki/${encKey}`;

    return {
      title: String(j.title),
      extract: String(j.extract),
      url: urlOut,
    };
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

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "");
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}