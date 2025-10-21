// src/lib/extractors.js
//
// Мінімальні екстрактори для Learn:
//  - fetchAndExtract(env, payload) -> { type, title, text, chunks, meta }
//  - Підтримка: text/html, text/plain/markdown, YouTube (мета), PDF/ZIP/бінарні (тільки мета)
//  - Без зовнішніх залежностей — сумісно з Cloudflare Workers.
//
// Використання у Learn-процесі:
// const { type, title, text, chunks, meta } = await fetchAndExtract(env, item.payload);
// Далі на chunks робимо короткі summary/інсайти (LLM), а файли — у R2.
//

// ─────────────────────────────────────────────────────────────────────────────
// Публічний API
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAndExtract(env, payload) {
  if (payload?.text) {
    const text = normalizePlainText(String(payload.text || ""));
    return {
      ok: true,
      type: "inline-text",
      title: payload?.name || guessTitleFromText(text) || "Нотатка",
      text,
      chunks: chunkText(text, 4000),
      meta: { source: "inline" },
    };
  }

  if (payload?.url) {
    const u = safeUrl(payload.url);
    if (!u) return { ok: false, error: "bad_url" };

    // YouTube: мета + (опційно) транскрипт у майбутньому
    if (isYouTube(u)) {
      const meta = await getYouTubeMeta(u).catch(() => null);
      const title = meta?.title || guessHumanTitleFromUrl(u) || "YouTube відео";
      return {
        ok: true,
        type: "youtube",
        title,
        text: "",
        chunks: [],
        meta: {
          kind: "youtube",
          url: u.toString(),
          ...cleanNulls(meta),
        },
      };
    }

    // Загальний fetch
    const res = await safeFetch(u.toString(), { method: "GET" });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    // Контент-тайп
    const ctype = (res.headers.get("content-type") || "").toLowerCase();

    // HTML сторінка → екстракція статті
    if (ctype.includes("text/html")) {
      const rawHtml = await res.text();
      const { title, text, meta } = extractFromHtml(rawHtml, u);
      return {
        ok: true,
        type: "article",
        title: title || payload?.name || u.hostname,
        text,
        chunks: chunkText(text, 4000),
        meta: {
          kind: "html",
          url: u.toString(),
          ...cleanNulls(meta),
        },
      };
    }

    // Прості тексти (txt/markdown)
    if (ctype.includes("text/plain") || looksLikePlainByPath(u.pathname)) {
      const body = await res.text();
      const text = normalizePlainText(body);
      return {
        ok: true,
        type: "text",
        title: payload?.name || guessTitleFromText(text) || u.hostname,
        text,
        chunks: chunkText(text, 4000),
        meta: { kind: "text", url: u.toString() },
      };
    }

    // PDF / архіви / інше — віддаємо метадані; сам файл кладемо у R2 поза межами цього модуля
    const rawBytes = await res.arrayBuffer(); // Для визначення розміру
    const size = rawBytes.byteLength || 0;

    const kind = detectBinaryKind(ctype, u.pathname);
    return {
      ok: true,
      type: kind, // "pdf" | "zip" | "binary"
      title: payload?.name || fileNameFromPath(u.pathname) || u.hostname,
      text: "",
      chunks: [],
      meta: {
        kind,
        url: u.toString(),
        contentType: ctype || "application/octet-stream",
        size,
        sizePretty: bytesFmt(size),
      },
    };
  }

  // Невідомий кейс
  return { ok: false, error: "unsupported_payload" };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML екстракція (Readability-лайт)
// ─────────────────────────────────────────────────────────────────────────────

export function extractFromHtml(html, baseUrlObj = null) {
  const cleaned = stripDangerous(html || "");
  const title = extractTitle(cleaned) || "";
  const meta = extractMeta(cleaned, baseUrlObj);
  const mainText = pickMainText(cleaned);

  return {
    title: (meta?.ogTitle || meta?.title || title || "").trim(),
    text: mainText.trim(),
    meta,
  };
}

function stripDangerous(html) {
  return String(html || "")
    // прибираємо скрипти/стилі/носкріпти
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    // зайві коментарі
    .replace(/<!--[\s\S]*?-->/g, "");
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]) : "";
}

function extractMeta(html, baseUrlObj) {
  const og = {};
  function metaContent(name) {
    const rx = new RegExp(
      `<meta[^>]+(?:name|property)=(?:"|')${name.replace(
        /[-/\\^$*+?.()|[\]{}]/g,
        "\\$&"
      )}(?:"|')[^>]*content=(?:"|')([^"']+)(?:"|')[^>]*>`,
      "i"
    );
    const m = html.match(rx);
    return m ? decodeEntities(m[1]) : "";
  }

  og.ogTitle = metaContent("og:title") || metaContent("twitter:title") || "";
  og.description =
    metaContent("description") || metaContent("og:description") || "";
  og.image = metaContent("og:image") || metaContent("twitter:image") || "";
  og.siteName = metaContent("og:site_name") || "";
  og.url = metaContent("og:url") || (baseUrlObj ? baseUrlObj.toString() : "");

  // favicon
  const fav = (() => {
    // <link rel="icon" href="..."> або apple-touch-icon
    const m =
      html.match(
        /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i
      ) ||
      html.match(
        /<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["'][^>]*>/i
      );
    if (!m) return "";
    const href = decodeEntities(m[1]);
    if (!href) return "";
    if (href.startsWith("http")) return href;
    try {
      const b = baseUrlObj || new URL("http://example.com/");
      return new URL(href, b).toString();
    } catch {
      return href;
    }
  })();

  const title = extractTitle(html);

  return {
    title: title,
    ...og,
    favicon: fav || "",
  };
}

// Проста евристика вибору основного тексту:
// 1) беремо <article> якщо є
// 2) або <main>
// 3) або найбільший блок з великою щільністю <p>/<li>
// 4) прибираємо навігаційні блоки за класами/ід (nav, header, footer, aside, promo)
function pickMainText(html) {
  const cleaned = removeNavBlocks(html);

  // article/main
  const blocks = [
    pickTag(cleaned, "article"),
    pickTag(cleaned, "main"),
    pickByDensity(cleaned),
  ];

  const firstGood = blocks.find((b) => b && b.trim().length > 200);
  const raw = firstGood || cleaned;

  // Перетворюємо в текст
  return htmlToText(raw);
}

function removeNavBlocks(html) {
  return html
    .replace(
      /<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    )
    .replace(
      /<div\b[^>]+class=["'][^"']*(nav|menu|header|footer|sidebar|aside|subscribe|promo|advert|ads)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      " "
    );
}

function pickTag(html, tag) {
  const rx = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(rx);
  return m ? m[1] : "";
}

function pickByDensity(html) {
  // Ріжемо на великі DIV/SECTION і обираємо той, де найбільше <p>/<li>
  const rx = /<(div|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let best = "";
  let bestScore = 0;
  let m;
  while ((m = rx.exec(html))) {
    const block = m[2] || "";
    const score =
      (block.match(/<p\b/gi)?.length || 0) * 3 +
      (block.match(/<li\b/gi)?.length || 0) * 2 +
      (block.length / 10000); // невеликий бонус за довжину
    if (score > bestScore) {
      best = block;
      bestScore = score;
    }
  }
  return best || "";
}

function htmlToText(fragment) {
  return decodeEntities(
    String(fragment || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube утиліти (метадані без API-ключа)
// ─────────────────────────────────────────────────────────────────────────────

function isYouTube(u) {
  const h = u.hostname.toLowerCase();
  return h.includes("youtube.com") || h === "youtu.be";
}

function getVideoId(u) {
  if (!u) return "";
  if (u.hostname === "youtu.be") {
    const last = (u.pathname || "").split("/").filter(Boolean).pop() || "";
    return last;
  }
  if (u.hostname.includes("youtube.com")) {
    const v = u.searchParams.get("v");
    if (v) return v;
    // формати /shorts/ID /embed/ID
    const m = u.pathname.match(/\/(shorts|embed)\/([^/?#]+)/i);
    if (m?.[2]) return m[2];
  }
  return "";
}

async function getYouTubeMeta(u) {
  const vid = getVideoId(u);
  if (!vid) return null;

  // Простий oEmbed (без ключа) — дістаємо заголовок/автора/thumbnail
  // https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json
  const oembed = await safeFetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${vid}`
    )}&format=json`,
    { method: "GET" }
  );
  if (!oembed.ok) return { id: vid, title: "YouTube відео" };

  const data = await oembed.json().catch(() => ({}));
  return {
    id: vid,
    title: data?.title || "YouTube відео",
    author: data?.author_name || "",
    provider: data?.provider_name || "YouTube",
    thumbnail: data?.thumbnail_url || "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Допоміжні утиліти
// ─────────────────────────────────────────────────────────────────────────────

function safeUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

async function safeFetch(url, init, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s = "") {
  if (!s) return "";
  const map = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return s
    .replace(/&(#\d+|#x[a-f0-9]+|[a-z]+);/gi, (m, g) => {
      if (g[0] === "#") {
        const code =
          g[1].toLowerCase() === "x"
            ? parseInt(g.slice(2), 16)
            : parseInt(g.slice(1), 10);
        return Number.isFinite(code) ? String.fromCharCode(code) : m;
      }
      return map[g.toLowerCase()] ?? m;
    })
    .trim();
}

function looksLikePlainByPath(pathname = "") {
  return /\.(txt|md|csv|log)(?:$|\?)/i.test(String(pathname || ""));
}

function fileNameFromPath(p) {
  try {
    return decodeURIComponent((p || "").split("/").filter(Boolean).pop() || "file");
  } catch {
    return "file";
  }
}

function guessHumanTitleFromUrl(u) {
  const last = fileNameFromPath(u?.pathname || "");
  if (u.hostname === "youtu.be") return last || "YouTube відео";
  if (u.hostname.includes("youtube.com")) {
    const v = u.searchParams.get("v");
    if (v) return v;
    return "YouTube відео";
  }
  return last || u.hostname;
}

function guessTitleFromText(text = "") {
  const firstLine = String(text || "").split(/\r?\n/).map(s => s.trim()).find(Boolean) || "";
  if (!firstLine) return "";
  // обрізаємо дуже довгі "перші рядки"
  return firstLine.length > 120 ? firstLine.slice(0, 117) + "…" : firstLine;
}

// ЕКСПОРТУЄМО bytesFmt (було потрібно імпортом у kvLearnQueue)
export function bytesFmt(n) {
  const b = Number(n || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024; if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024; if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024; return `${gb.toFixed(2)} GB`;
}

function cleanNulls(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  });
  return out;
}

function detectBinaryKind(ctype, path) {
  const p = (path || "").toLowerCase();
  if (ctype.includes("pdf") || /\.pdf(?:$|\?)/.test(p)) return "pdf";
  if (
    ctype.includes("zip") ||
    /\.zip(?:$|\?)/.test(p) ||
    /\.7z(?:$|\?)/.test(p) ||
    /\.rar(?:$|\?)/.test(p)
  ) {
    return "zip";
  }
  return "binary";
}

function normalizePlainText(s = "") {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ЕКСПОРТУЄМО chunkText (імпортується як `chunkText as chunkTextForIndex`)
export function chunkText(s, size = 4000) {
  const out = [];
  let t = String(s || "");
  while (t.length) {
    out.push(t.slice(0, size));
    t = t.slice(size);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Сумісність зі старими імпортами з інших модулів
// ─────────────────────────────────────────────────────────────────────────────

// kvLearnQueue.js очікує named-export `extractFromUrl`
export { fetchAndExtract as extractFromUrl };