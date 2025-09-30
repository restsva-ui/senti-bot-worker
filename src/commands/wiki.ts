// src/commands/wiki.ts
import type { Env, TgCtx, TgMessage } from "../types";

type Lang = "uk" | "ru" | "en" | "de" | "fr";
const DEFAULT_LANG: Lang = "uk";

function parseArgs(text: string) {
  const withoutCmd = text.replace(/^\/wiki(@\w+)?\s*/i, "").trim();
  if (!withoutCmd) return { lang: DEFAULT_LANG, q: "" };
  const m = withoutCmd.match(/^(uk|ru|en|de|fr)\s+(.+)$/i);
  if (m) return { lang: m[1].toLowerCase() as Lang, q: m[2].trim() };
  return { lang: DEFAULT_LANG, q: withoutCmd };
}

async function send(ctx: TgCtx, chatId: number, text: string, replyTo?: number) {
  const url = `${ctx.env.API_BASE_URL || "https://api.telegram.org"}/bot${ctx.env.BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, reply_to_message_id: replyTo, disable_web_page_preview: false };
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function fetchSummary(lang: Lang, q: string) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (r.ok) {
    const j = await r.json();
    if (j?.extract && j?.content_urls?.desktop?.page) {
      return { title: j.title || q, extract: j.extract as string, link: j.content_urls.desktop.page as string };
    }
  }
  const os = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(q)}&limit=1`);
  if (os.ok) {
    const arr = await os.json();
    const title = (arr?.[1]?.[0] as string) || q;
    if (title) {
      const r2 = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (r2.ok) {
        const j2 = await r2.json();
        if (j2?.extract && j2?.content_urls?.desktop?.page) {
          return { title: j2.title || title, extract: j2.extract as string, link: j2.content_urls.desktop.page as string };
        }
      }
    }
  }
  return null;
}

export async function wikiSetAwait(ctx: TgCtx, chatId: number) {
  try { await ctx.env.LIKES_KV?.put(`await:${chatId}`, "1", { expirationTtl: 300 }); } catch {}
}

export async function wikiMaybeHandleFreeText(_ctx: TgCtx, _msg: TgMessage) {
  return false;
}

async function wiki(ctx: TgCtx, msg: TgMessage) {
  const chatId = msg.chat.id;
  const replyTo = msg.message_id;

  try {
    const text = msg.text || msg.caption || "";
    const { lang, q } = parseArgs(text);

    if (!q) {
      await send(ctx, chatId, "📚 Надішли так: `/wiki [uk|ru|en|de|fr] <запит>`\nНапр.: `/wiki Київ` або `/wiki en Vienna`", replyTo);
      return;
    }

    const res = await fetchSummary(lang, q);
    if (!res) {
      await send(ctx, chatId, `Нічого не знайшов за запитом: *${q}* (${lang}).`, replyTo);
      return;
    }

    const out =
      `📚 *${res.title}*\n\n` +
      `${res.extract}\n\n` +
      `🔗 ${res.link}`;

    await send(ctx, chatId, out, replyTo);
  } catch (e: any) {
    console.error("wiki error:", e?.stack || e?.message || e);
    await send(ctx, chatId, "❌ Помилка при пошуку у Вікіпедії.", replyTo);
  }
}

export { wiki };        // ✅ named export
export default wiki;    // ✅ default export