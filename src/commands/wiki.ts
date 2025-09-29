// src/commands/wiki.ts
// Легка, але надійна реалізація /wiki з підтримкою "очікування наступного повідомлення" через KV.
// Експортує іменовані обробники: wiki, wikiSetAwait, wikiMaybeHandleFreeText.
// Також залишено export default для сумісності (якщо десь викликається за замовчуванням).

// Типи навмисно "any", щоб не ламати збірку в esbuild без TS typecheck.
type Ctx = any;

const AWAIT_KEY = (chatId: string | number) => `await:wiki:${chatId}`;
const AWAIT_TTL_SECONDS = 60 * 5; // 5 хвилин

async function fetchWikiSummary(lang: string, query: string) {
  const q = query.trim();
  const safeTitle = encodeURIComponent(q.replace(/\s+/g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${safeTitle}`;

  const r = await fetch(url, { headers: { "accept": "application/json" } });
  if (!r.ok) throw new Error(`wiki ${lang} ${q}: ${r.status}`);
  const data = await r.json() as any;

  const title = data.title || q;
  const extract: string = data.extract || "";
  const link = data.content_urls?.desktop?.page
    ?? `https://${lang}.wikipedia.org/wiki/${safeTitle}`;

  return { title, extract, link };
}

function detectLangAndQuery(text: string) {
  // Варіанти:
  // 1) "en Albert Einstein"
  // 2) "Київ"
  const parts = text.trim().split(/\s+/);
  const maybeLang = (parts[0] || "").toLowerCase();
  const supported = new Set(["uk", "ru", "en", "de", "fr"]);

  if (supported.has(maybeLang) && parts.length > 1) {
    return { lang: maybeLang, query: parts.slice(1).join(" ") };
  }
  return { lang: "uk", query: text.trim() };
}

async function reply(ctx: Ctx, text: string, opts?: any) {
  // Узгоджено з іншими командами: в них найчастіше є ctx.reply
  if (typeof ctx?.reply === "function") return ctx.reply(text, opts);

  // Бекап: якщо є chatId + send, спробуємо мінімальний шлях
  if (ctx?.chatId && typeof ctx?.send === "function") return ctx.send(ctx.chatId, text);

  // Останній варіант — просто нічого не робимо, щоб не зламати збірку
}

/** Увімкнути режим "чекаю наступне повідомлення як запит wiki" */
export async function wikiSetAwait(ctx: Ctx) {
  const chatId = ctx?.chat?.id ?? ctx?.chatId ?? ctx?.update?.message?.chat?.id;
  if (!chatId) return;

  const kv = ctx?.env?.LIKES_KV || ctx?.env?.KV || ctx?.LIKES_KV;
  if (kv?.put) {
    await kv.put(AWAIT_KEY(chatId), "1", { expirationTtl: AWAIT_TTL_SECONDS });
  }
}

/** Якщо юзер відповів наступним повідомленням — перехоплюємо та виконуємо wiki */
export async function wikiMaybeHandleFreeText(ctx: Ctx, text: string) {
  const chatId = ctx?.chat?.id ?? ctx?.chatId ?? ctx?.update?.message?.chat?.id;
  if (!chatId) return false;

  const kv = ctx?.env?.LIKES_KV || ctx?.env?.KV || ctx?.LIKES_KV;
  if (!kv?.get) return false;

  const flag = await kv.get(AWAIT_KEY(chatId));
  if (!flag) return false;

  // Зняти прапорець, щоб не зациклитись
  if (kv?.delete) await kv.delete(AWAIT_KEY(chatId));

  await wiki(ctx, text);
  return true;
}

/** Основний обробник команди /wiki */
export async function wiki(ctx: Ctx, argLine?: string) {
  const argsRaw =
    argLine ??
    ctx?.args?.join?.(" ") ??
    ctx?.text?.trim?.() ??
    "";

  const trimmed = (argsRaw || "").trim();

  // Якщо аргументів нема — вмикаємо "очікування" та просимо ввести запит
  if (!trimmed) {
    await wikiSetAwait(ctx);
    await reply(
      ctx,
      "✍️ Введіть запит для Wiki у наступному повідомленні (відповіддю)."
    );
    return;
  }

  const { lang, query } = detectLangAndQuery(trimmed);

  try {
    // 1) Спроба вибраною мовою
    let res = await fetchWikiSummary(lang, query);

    // Якщо тексту майже немає — fallback на en
    if (!res.extract || res.extract.length < 20) {
      if (lang !== "en") {
        res = await fetchWikiSummary("en", query);
      }
    }

    const titleLine = `📚 <b>${res.title}</b>`;
    const body = res.extract?.trim()
      ? res.extract.trim().slice(0, 1800) // трішки обрізаємо, щоб не спамити
      : "Нічого не знайшов у статті.";

    const linkLine = `\n\n🔗 <a href="${res.link}">${res.link}</a>`;

    await reply(ctx, `${titleLine}\n\n${body}${linkLine}`, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
  } catch (e) {
    // Сама проста і дружня відповідь
    await reply(ctx, `Не вдалося отримати статтю за запитом: ${query}`);
  }
}

// Сумісність з можливим default-імпортом в інших місцях
export default wiki;