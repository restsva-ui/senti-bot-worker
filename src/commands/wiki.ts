// src/commands/wiki.ts
import type { TgUpdate } from "../types";

type EnvBase = { BOT_TOKEN: string; API_BASE_URL?: string };

// Підтримувані мови
type Lang = "uk" | "ru" | "en" | "de" | "fr";
const DEFAULT_LANG_ORDER: Lang[] = ["uk", "ru", "en", "de", "fr"];

export const wikiCommand = {
  name: "wiki",
  description:
    "Пошук стислої довідки у Вікіпедії (uk/ru/en/de/fr). Можна: /wiki <lang> <запит>",
  async execute(env: EnvBase, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text ?? "";
    if (!chatId) return;

    const raw = text.replace(/^\/wiki(?:@\w+)?/i, "").trim();

    if (!raw) {
      const usage =
        "Використання: <code>/wiki Київ</code>\n" +
        "Або з мовою: <code>/wiki de Berlin</code>\n" +
        "Мови: uk, ru, en, de, fr";
      await sendMessage(env, chatId, usage, { parse_mode: "HTML" });
      return;
    }

    const { query, preferLang } = parseLangFromQuery(raw);
    const langOrder = buildLangOrder(preferLang, getUserLang(update));

    // Пошук послідовно різними мовами
    let found: Awaited<ReturnType<typeof searchPage>> | null = null;
    for (const L of langOrder) {
      found = await searchPage(L, query);
      if (found) break;
    }

    if (!found) {
      await sendMessage(env, chatId, `Нічого не знайшов за запитом: <b>${escapeHtml(query)}</b>`, {
        parse_mode: "HTML",
      });
      return;
    }

    // Детальніший summary по exact key (якщо є)
    const sum =
      (await fetchSummary(found.lang, found.key)) ||
      { title: found.title, extract: stripHtml(found.excerpt), url: found.url };

    const MAX = 1200;
    const body =
      `<b>${escapeHtml(sum.title)}</b>\n` +
      `${escapeHtml(sum.extract.length > MAX ? sum.extract.slice(0, MAX - 1) + "…" : sum.extract)}`;

    const keyboard = { inline_keyboard: [[{ text: "🔗 Відкрити у Вікіпедії", url: sum.url }]] };
    await sendMessage(env, chatId, body, { parse_mode: "HTML", reply_markup: keyboard });
  },
} as const;

/* ---------------- Wikipedia helpers ---------------- */

async function searchPage(lang: Lang, q: string) {
  try {
    const enc = encodeURIComponent(q);
    const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${enc}&limit=1`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "SentiBot/1.0 (Cloudflare Worker)" },
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
      key: String(page.key),
      excerpt: String(page.excerpt ?? ""),
      url: urlOut,
    };
  } catch {
    return null;
  }
}

async function fetchSummary(lang: Lang, key: string) {
  try {
    const encKey = encodeURIComponent(key);
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encKey}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "SentiBot/1.0 (Cloudflare Worker)" },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j?.title || !j?.extract) return null;

    const urlOut =
      (j?.content_urls?.desktop?.page as string) ||
      `https://${lang}.wikipedia.org/wiki/${encKey}`;

    return { title: String(j.title), extract: String(j.extract), url: urlOut };
  } catch {
    return null;
  }
}

/* ---------------- Lang helpers ---------------- */

function parseLangFromQuery(raw: string): { query: string; preferLang?: Lang } {
  const m = raw.match(/^([a-z]{2})\s+(.+)/i);
  if (m) {
    const code = m[1].toLowerCase();
    const rest = m[2].trim();
    if (isSupportedLang(code)) return { query: rest, preferLang: code as Lang };
  }
  return { query: raw };
}
function buildLangOrder(prefer?: Lang, userLang?: Lang): Lang[] {
  const order: Lang[] = [];
  if (prefer && !order.includes(prefer)) order.push(prefer);
  if (userLang && !order.includes(userLang)) order.push(userLang);
  for (const l of DEFAULT_LANG_ORDER) if (!order.includes(l)) order.push(l);
  return order;
}
function getUserLang(update: TgUpdate): Lang | undefined {
  const code = (update.message as any)?.from?.language_code as string | undefined;
  if (!code) return undefined;
  const c2 = code.slice(0, 2).toLowerCase();
  return isSupportedLang(c2) ? (c2 as Lang) : undefined;
}
function isSupportedLang(code: string): code is Lang {
  return (["uk", "ru", "en", "de", "fr"] as const).includes(code as Lang);
}

/* ---------------- Telegram low-level ---------------- */

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

/* ---------------- utils ---------------- */

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "");
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}