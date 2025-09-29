// src/commands/wiki.ts
import type { TgUpdate } from "../types";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string };

const WIKI_LANGS = ["uk", "ru", "en", "de", "fr"] as const;
type Lang = (typeof WIKI_LANGS)[number];

export const wikiCommand = {
  name: "wiki",
  description:
    "Пошук стислої довідки у Вікіпедії (uk/ru/en/de/fr). Можна: /wiki <lang?> <запит>",
  async execute(env: Env, update: TgUpdate) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return;

    const raw = (msg?.text ?? msg?.caption ?? "").trim();

    // Витягуємо аргументи після /wiki (з урахуванням /wiki@botname)
    const args = extractArgs(raw, "wiki");

    // Якщо аргументів немає — просимо ввести запит (reply-флоу)
    if (!args) {
      await sendMessage(
        env,
        chatId,
        "🔎 Введіть запит для /wiki:",
        { reply_to_message_id: msg?.message_id }
      );
      return;
    }

    // Парсимо можливу мову + сам запит
    const { lang, query } = parseLangAndQuery(args);
    if (!query) {
      await sendMessage(env, chatId, "Не бачу запиту. Приклад: /wiki Київ або /wiki en Berlin");
      return;
    }

    const summary =
      (await fetchSummarySafe(lang, query)) ??
      // fallback: якщо з мовою не знайшли — пробуємо по колу мов
      (await tryOtherLangs(query, lang));

    if (!summary) {
      await sendMessage(
        env,
        chatId,
        `Нічого не знайшов за запитом: ${query}`
      );
      return;
    }

    const text = `<b>${summary.title}</b>\n${summary.extract}`;
    await sendMessage(env, chatId, text, { parse_mode: "HTML" });
  },
} as const;

/* -------------------- helpers -------------------- */
function extractArgs(text: string, cmd: string): string | null {
  // приклади: "/wiki Київ", "/wiki@SentiBot en Berlin"
  const re = new RegExp(`^\\/${cmd}(?:@\\w+)?\\s*(.*)$`, "i");
  const m = text.match(re);
  const tail = (m?.[1] ?? "").trim();
  return tail.length ? tail : null;
}

function parseLangAndQuery(tail: string): { lang: Lang; query: string } {
  const parts = tail.split(/\s+/);
  const maybeLang = parts[0]?.toLowerCase() as Lang | undefined;
  if (maybeLang && (WIKI_LANGS as readonly string[]).includes(maybeLang)) {
    return { lang: maybeLang as Lang, query: parts.slice(1).join(" ").trim() };
  }
  return { lang: "uk", query: tail };
}

async function fetchSummarySafe(lang: Lang, query: string) {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      query
    )}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    if (j?.type === "disambiguation" && j?.titles?.normalized) {
      // якщо дизамбіґ — все одно повернемо вступ
      return { title: j.titles.normalized as string, extract: j.extract as string };
    }
    if (j?.extract && j?.title) {
      return { title: j.title as string, extract: j.extract as string };
    }
  } catch {}
  return null;
}

async function tryOtherLangs(query: string, skip: Lang) {
  for (const l of WIKI_LANGS) {
    if (l === skip) continue;
    const s = await fetchSummarySafe(l, query);
    if (s) return s;
  }
  return null;
}

/* -------------------- low-level telegram -------------------- */
async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}