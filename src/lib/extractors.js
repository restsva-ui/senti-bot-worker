// Простий набір екстракторів для Learn:
// - HTML-статті (виділення основного тексту)
// - YouTube (спроба дістати транскрипт, якщо доступний)
// - Текстові/JSON/CSV файли
// - Чанкінг тексту для подальшої індексації (Vectorize)
//
// Усі функції — без зовнішніх залежностей, сумісні з Cloudflare Workers.

const TEXT_MIME = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];

function normMime(m) {
  if (!m) return "";
  return String(m).split(";")[0].trim().toLowerCase();
}

function stripTags(html = "") {
  // Прибираємо <script>/<style>, коментарі, потім теги
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Зберегти розділювачі для <p>, <br>, <li>, <h1..h6>
  s = s.replace(/<(\/)?(p|br|li|h[1-6]|div|section|article)\b[^>]*>/gi, "\n");
  // Прибрати решту тегів
  s = s.replace(/<[^>]+>/g, " ");
  // Декодування найчастіших HTML-ентіті
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  // Нормалізація пробілів
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function extractTitle(html = "", fallback = "") {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m?.[1]) {
    return stripTags(m[1]).replace(/\s+/g, " ").trim().slice(0, 180);
  }
  // спроба з og:title / twitter:title
  const m2 =
    String(html || "").match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    String(html || "").match(/name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
  if (m2?.[1]) return String(m2[1]).trim().slice(0, 180);
  return fallback || "Без назви";
}

function guessMainFromHtml(html = "") {
  // Дуже проста евристика: якщо є <article> — беремо його, інакше — усе тіло
  let body = "";
  const art = html.match(/<article[\s\S]*?<\/article>/i);
  if (art?.[0]) body = art[0];
  else {
    const main = html.match(/<main[\s\S]*?<\/main>/i);
    body = main?.[0] || html;
  }
  const text = stripTags(body);
  // Відсікти «хвости» навігації/футерів: беремо найдовший абзацний блок
  const chunks = text.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  if (!chunks.length) return text;
  chunks.sort((a, b) => b.length - a.length);
  // Візьмемо топ-3 великих блоки, склеїмо
  const main3 = chunks.slice(0, 3).join("\n\n");
  return main3.length > 400 ? main3 : text;
}

export async function fetchAndExtractArticle(url) {
  let r;
  try {
    r = await fetch(url, { method: "GET" });
  } catch (e) {
    return { ok: false, error: `fetch failed: ${String(e?.message || e)}` };
  }
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };

  const html = await r.text();
  const title = extractTitle(html, new URL(url).hostname);
  const text = guessMainFromHtml(html);
  if (!text || text.length < 120) {
    return { ok: false, error: "no_main_text", title, rawLength: html.length };
  }
  return {
    ok: true,
    kind: "web-article",
    title,
    text,
    source: url,
  };
}

export async function fetchTextFromUrl(url) {
  let r;
  try {
    r = await fetch(url, { method: "GET" });
  } catch (e) {
    return { ok: false, error: `fetch failed: ${String(e?.message || e)}` };
  }
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };

  const ct = normMime(r.headers.get("content-type"));
  // Підтримка текстових типів
  if (TEXT_MIME.includes(ct) || ct.startsWith("text/")) {
    const text = await r.text();
    return { ok: true, kind: "text", mime: ct || "text/plain", text, source: url };
  }
  // JSON як текст
  if (ct === "application/json") {
    const raw = await r.text();
    return { ok: true, kind: "text", mime: ct, text: raw, source: url };
  }
  // CSV
  if (ct === "text/csv") {
    const raw = await r.text();
    return { ok: true, kind: "text", mime: ct, text: raw, source: url };
  }

  // Непідтримуваний тип для інлайнового парсингу (pdf/docx/zip/відео/зображення)
  return { ok: false, error: `unsupported_content_type:${ct || "unknown"}` };
}

// === YouTube ===

function ytIdFromUrl(u) {
  try {
    const url = new URL(u);
    if (url.hostname === "youtu.be") {
      return url.pathname.replace("/", "").trim();
    }
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Найпростіша спроба дістати транскрипт без офіційного ключа:
 * - деякі публічні сервіси повертають XML/JSON субтитри
 * - працює не завжди (може 403/404)
 */
export async function tryFetchYouTubeTranscript(videoUrl) {
  const id = ytIdFromUrl(videoUrl);
  if (!id) return { ok: false, error: "not_youtube" };

  // Популярний ендпоінт (може не працювати для окремих роликів/регіонів)
  const candidates = [
    `https://youtubetranscript.com/?server_vid2=${encodeURIComponent(id)}`,
    // Можливі додаткові дзеркала / API — додати за потреби.
  ];

  for (const u of candidates) {
    try {
      const r = await fetch(u, { method: "GET" });
      if (!r.ok) continue;
      const t = await r.text();
      // Проста евристика: у відповідях цього сервісу приходить HTML з <text>...</text> або JSON
      const xmlLike = t.match(/<text[^>]*>([\s\S]*?)<\/text>/gi);
      if (xmlLike?.length) {
        const joined = xmlLike
          .map(x => x.replace(/<[^>]+>/g, " "))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (joined && joined.length > 60) {
          return {
            ok: true,
            kind: "youtube",
            title: `YouTube #${id}`,
            text: joined,
            source: videoUrl,
          };
        }
      }
      // Якщо JSON
      try {
        const j = JSON.parse(t);
        if (Array.isArray(j) && j.length) {
          const joined = j.map(n => (n?.text || "").trim()).join(" ");
          if (joined && joined.length > 60) {
            return {
              ok: true,
              kind: "youtube",
              title: `YouTube #${id}`,
              text: joined,
              source: videoUrl,
            };
          }
        }
      } catch {}
    } catch {}
  }

  return { ok: false, error: "transcript_unavailable", id };
}

// === Чанкінг ===

export function chunkText(text, { size = 1000, overlap = 200 } = {}) {
  const s = String(text || "").trim();
  if (!s) return [];
  const safeSize = Math.max(200, Number(size) || 1000);
  const safeOverlap = Math.min(Math.max(0, Number(overlap) || 200), Math.floor(safeSize / 2));

  const chunks = [];
  let i = 0;
  while (i < s.length) {
    const end = Math.min(s.length, i + safeSize);
    let slice = s.slice(i, end);

    // намагаємося різати по межі речення
    if (end < s.length) {
      const back = slice.lastIndexOf(". ");
      if (back > safeSize * 0.6) {
        slice = slice.slice(0, back + 1);
      }
    }

    chunks.push(slice.trim());
    if (end >= s.length) break;
    i += safeSize - safeOverlap;
  }
  return chunks.filter(Boolean);
}

// === Головний універсальний екстрактор для URL ===

export async function extractFromUrl(url) {
  // 1) YouTube → спроба транскрипту
  const id = ytIdFromUrl(url);
  if (id) {
    const y = await tryFetchYouTubeTranscript(url);
    if (y.ok) return y;
    // якщо транскрипт недоступний — впадемо до HTML-сторінки (опис)
  }

  // 2) Текстові / JSON / CSV
  const t = await fetchTextFromUrl(url);
  if (t.ok) {
    // для JSON водночас перетворимо в «pretty»
    const title = (id ? `YouTube #${id}` : new URL(url).hostname);
    let text = t.text;
    if (t.mime === "application/json") {
      try { text = JSON.stringify(JSON.parse(t.text), null, 2); } catch {}
    }
    return { ok: true, kind: "text", title, text, source: url, mime: t.mime };
  }

  // 3) HTML-стаття
  const art = await fetchAndExtractArticle(url);
  if (art.ok) return art;

  // 4) Якщо все інше не спрацювало — повідомляємо, що тип не підтримано
  return { ok: false, error: t.error || art.error || "unrecognized_content" };
}

export function bytesFmt(n) {
  const b = Number(n || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024; if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024; if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024; return `${gb.toFixed(2)} GB`;
}