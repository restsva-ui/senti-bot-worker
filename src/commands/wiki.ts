// src/commands/wiki.ts
// Команда /wiki з простим очікуванням наступного повідомлення (await)
// та хелперами wikiSetAwait / wikiMaybeHandleFreeText.
//
// Підтримані мови: uk|ru|en|de|fr (за замовчуванням — uk).
// Приклади:
//   /wiki Київ
//   /wiki en Vienna
//   /wiki  -> просить ввести запит наступним повідомленням

type Ctx = any;
type Msg = any;

// ===== Внутрішнє "сховище очікувань" (на випадок, якщо KV недоступне) =====
const memoryAwait = new Map<string, number>(); // key = chatId, value = expireTs

const AWAIT_TTL_SEC = 5 * 60; // 5 хв

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function chatKey(msg: Msg): string {
  // спробуємо знайти чат-id типово як у Telegram
  const id =
    msg?.chat?.id ??
    msg?.message?.chat?.id ??
    msg?.from?.id ??
    "unknown";
  return String(id);
}

// ===== Хелпери (експортуються) =============================================

/** Увімкнути режим очікування наступного повідомлення для /wiki */
export async function wikiSetAwait(ctx: Ctx, msg: Msg): Promise<void> {
  const key = `wiki:await:${chatKey(msg)}`;
  const expire = nowSec() + AWAIT_TTL_SEC;

  // Якщо у середовищі є KV (наприклад LIKES_KV), скористаємось ним
  const kv: any = ctx?.env?.LIKES_KV ?? ctx?.env?.KV ?? null;
  if (kv?.put) {
    try {
      await kv.put(key, "1", { expirationTtl: AWAIT_TTL_SEC });
      return;
    } catch (_) {
      // падаємо у in-memory fallback
    }
  }
  memoryAwait.set(key, expire);
}

/** Якщо користувач надіслав вільний текст і ми чекали /wiki — перехоплюємо. */
export async function wikiMaybeHandleFreeText(ctx: Ctx, msg: Msg): Promise<boolean> {
  const text: string = msg?.text ?? "";
  if (!text || text.startsWith("/")) return false; // це команда, не вільний текст

  const key = `wiki:await:${chatKey(msg)}`;

  // спочатку KV
  const kv: any = ctx?.env?.LIKES_KV ?? ctx?.env?.KV ?? null;
  let awaited = false;

  if (kv?.get) {
    try {
      const v = await kv.get(key);
      if (v) {
        awaited = true;
        // гасимо прапорець
        if (kv.delete) await kv.delete(key);
        else await kv.put(key, "", { expirationTtl: 1 });
      }
    } catch (_) {
      // fallback нижче
    }
  }

  if (!awaited) {
    const exp = memoryAwait.get(key);
    if (exp && exp > nowSec()) {
      awaited = true;
    }
    memoryAwait.delete(key);
  }

  if (!awaited) return false;

  // Якщо ми тут — це вільний текст після /wiki. Виконуємо пошук як запит.
  await wiki(ctx, { ...msg, text }); // викликаємо саму команду
  return true;
}

// ===== Основна команда /wiki ===============================================

async function fetchWiki(lang: string, query: string) {
  const title = encodeURIComponent(query.trim());
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`;
  const r = await fetch(url, {
    headers: { "accept": "application/json" },
  });
  if (!r.ok) throw new Error(`Wiki HTTP ${r.status}`);
  return r.json();
}

function parseArgs(text: string): { lang: string; query: string } {
  // розбираємо: "/wiki [<lang>] <запит>"
  // якщо перше слово — одна з підтриманих мов, візьмемо її
  const supported = new Set(["uk", "ru", "en", "de", "fr"]);
  const parts = text.replace(/^\/\w+\s*/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { lang: "uk", query: "" };
  if (supported.has(parts[0].toLowerCase())) {
    const lang = parts.shift()!.toLowerCase();
    return { lang, query: parts.join(" ") };
    }
  return { lang: "uk", query: parts.join(" ") };
}

function reply(ctx: Ctx, text: string, extra: any = {}) {
  // універсальна відповідь
  if (typeof ctx?.reply === "function") return ctx.reply(text, extra);
  if (typeof ctx?.send === "function") return ctx.send(text, extra);
  return text;
}

export async function wiki(ctx: Ctx, msg: Msg) {
  const text: string = msg?.text ?? "";
  const { lang, query } = parseArgs(text);

  // Якщо запиту нема — підкажемо і увімкнемо очікування
  if (!query) {
    await reply(
      ctx,
      "✍️ Введіть запит для Wiki у наступному повідомленні (відповіддю)."
    );
    await wikiSetAwait(ctx, msg);
    return;
  }

  try {
    const data: any = await fetchWiki(lang, query);

    const title = data?.title ?? query;
    const extract = data?.extract ?? "Нічого не знайшов…";
    const pageUrl = data?.content_urls?.desktop?.page ?? data?.content_urls?.mobile?.page;

    let out = `📚 *${title}*\n\n${extract}`;
    if (pageUrl) out += `\n\n🔗 ${pageUrl}`;

    await reply(ctx, out, { parse_mode: "Markdown" });
  } catch (err: any) {
    await reply(
      ctx,
      `⚠️ Не вдалося отримати статтю за запитом: *${query}* (${lang}). Спробуйте інший запит.`,
      { parse_mode: "Markdown" }
    );
  }
}

// Експорти як вимагає реєстр
export { wiki as wikiExport }; // не обовʼязково, але не завадить
export default wiki;