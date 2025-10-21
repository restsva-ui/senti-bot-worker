// src/lib/kvLearnQueue.js
/**
 * Learn queue + реальне збереження у R2 і інсайти у KV + LLM-узагальнення.
 *
 * KV keys:
 *   - learn:q:<ts>:<rand>        -> JSON item { id, userId, kind, payload, at, status }
 *   - learn:last_summary         -> короткий підсумок останнього прогону
 *   - learned:<ts>:<id>          -> JSON learned item {
 *        id, userId, kind, src, title, meta, at,
 *        r2Key?, r2Size?,
 *        insight,                 // коротка людська фраза
 *        summary?, bullets?       // ✨ нове: LLM-резюме + буліти (якщо є текст)
 *     }
 *
 * Feature flags / bindings:
 *   - env.LEARN_ENABLED ("on" / "off")
 *   - env.LEARN_QUEUE_KV (KV namespace) — обовʼязково
 *   - env.LEARN_BUCKET   (R2 bucket)    — опціонально (для зберігання файлів)
 *   - env.MODEL_ORDER    (рядок, напр. "gemini,cf,openrouter") — опціонально
 *   - LLM ключі зчитує think()/askAnyModel всередині
 */

import { fetchAndExtract, chunkText as chunkTextUtil } from "./extractors.js";
import { think } from "./brain.js";              // базова LLM-функція
import { askAnyModel } from "./modelRouter.js";  // якщо налаштовано MODEL_ORDER

const Q_PREFIX = "learn:q:";
const K_LAST_SUMMARY = "learn:last_summary";
const L_PREFIX = "learned:";

function enabled(env) {
  return String(env?.LEARN_ENABLED || "on").toLowerCase() !== "off";
}

function kv(env) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  return kv;
}

function r2(env) {
  return env?.LEARN_BUCKET || null; // опціонально
}

function id() {
  return Math.random().toString(36).slice(2) + "-" + Date.now();
}
function nowIso() { return new Date().toISOString(); }

function bytesFmt(n) {
  const b = Number(n || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024; if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024; if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024; return `${gb.toFixed(2)} GB`;
}

/** Put any learn payload into queue */
export async function enqueueLearn(env, userId, payload) {
  if (!enabled(env)) return { ok: false, reason: "learn_disabled" };
  const item = {
    id: id(),
    userId: String(userId || "anon"),
    kind: detectKind(payload),
    payload,
    at: nowIso(),
    status: "queued",
  };
  const key = `${Q_PREFIX}${Date.now()}:${item.id}`;
  await kv(env).put(key, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 14 }); // 14 днів
  return { ok: true, key, item };
}

function detectKind(payload) {
  if (payload?.url) return "url";
  if (payload?.file || payload?.blob || payload?.name?.match?.(/\.(zip|rar|7z|pdf|docx?|xlsx?|pptx?|txt|md|csv|json|png|jpg|jpeg|mp4|mov)$/i)) return "file";
  if (payload?.text) return "text";
  return "unknown";
}

/** Легка вибірка черги */
export async function listQueued(env, { limit = 50 } = {}) {
  const list = await kv(env).list({ prefix: Q_PREFIX, limit });
  const out = [];
  for (const k of list.keys || []) {
    const raw = await kv(env).get(k.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch {}
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Внутрішнє: delete key */
async function del(env, key) {
  try { await kv(env).delete(key); } catch {}
}

/** Зберегти короткий summary для UI */
export async function saveLastSummary(env, text) {
  await kv(env).put(K_LAST_SUMMARY, String(text || ""), { expirationTtl: 60 * 60 * 24 * 30 });
}
/** Прочитати останній summary */
export async function getLastSummary(env) {
  return (await kv(env).get(K_LAST_SUMMARY)) || "";
}

/** Зберегти “вивчене” (інсайт) у KV */
async function saveLearned(env, obj) {
  const key = `${L_PREFIX}${Date.now()}:${obj?.id || id()}`;
  await kv(env).put(key, JSON.stringify(obj), { expirationTtl: 60 * 60 * 24 * 180 }); // 6 міс
  return key;
}

/** Отримати останні інсайти для System Prompt */
export async function getRecentInsights(env, { limit = 5 } = {}) {
  const list = await kv(env).list({ prefix: L_PREFIX, limit: 200 });
  const arr = [];
  for (const k of list.keys || []) {
    const raw = await kv(env).get(k.name);
    if (!raw) continue;
    try { arr.push(JSON.parse(raw)); } catch {}
  }
  arr.sort((a, b) => (a?.at < b?.at ? 1 : -1));
  return arr.slice(0, limit);
}

/** Головний однопрохідний процесор */
export async function runLearnOnce(env, { maxItems = 8, lang = "uk" } = {}) {
  if (!enabled(env)) return { ok: false, reason: "learn_disabled" };

  const toProcess = [];
  const listing = await kv(env).list({ prefix: Q_PREFIX, limit: maxItems });
  for (const k of listing.keys || []) {
    const raw = await kv(env).get(k.name);
    if (!raw) { await del(env, k.name); continue; }
    try {
      const item = JSON.parse(raw);
      toProcess.push({ key: k.name, item });
    } catch {
      await del(env, k.name);
    }
  }

  const results = [];
  for (const { key, item } of toProcess) {
    try {
      const res = await learnItem(env, item, { lang });
      results.push({ id: item.id, ok: true, ...res });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: String(e?.message || e) });
    } finally {
      await del(env, key);
    }
  }

  const summary = makeSummary(results);
  await saveLastSummary(env, summary);

  return { ok: true, processed: results.length, results, summary };
}

/** === Реальне “засвоєння” одиниці матеріалу ===
 *  - розпізнаємо джерело
 *  - пробуємо витягнути текст/мета (fetchAndExtract)
 *  - якщо текст є → робимо LLM-узагальнення (summary/bullets)
 *  - для файлів/посилань на файли — зберігаємо в R2 (якщо прив’язано LEARN_BUCKET)
 *  - формуємо людяний інсайт, зберігаємо у KV (learned:*)
 */
async function learnItem(env, item, { lang = "uk" } = {}) {
  const { kind, payload, userId } = item;

  let title = "";
  let src = "";
  let meta = { type: "unknown" };
  let r2Key = null;
  let r2Size = 0;
  let summary = "";
  let bullets = [];

  // 1) Якщо це URL або текст — пробуємо розпарсити зміст
  if (payload?.url || payload?.text) {
    const extracted = await fetchAndExtract(env, payload).catch(() => null);
    if (extracted?.ok) {
      src = payload?.url || payload?.name || "inline";
      title = extracted.title || payload?.name || "матеріал";
      meta = { ...(extracted.meta || {}), type: extracted.type || "unknown" };

      // ✨ 1.1) Якщо є текст — узагальнюємо
      const text = String(extracted.text || "").trim();
      const chunks = Array.isArray(extracted.chunks) ? extracted.chunks : (text ? chunkText(text, 4000) : []);
      if (chunks.length) {
        const sres = await summarizeChunksWithLLM(env, { title, chunks, lang }).catch(() => null);
        if (sres) {
          summary = sres.summary || "";
          bullets = Array.isArray(sres.bullets) ? sres.bullets.slice(0, 10) : [];
        }
      }

      // 1.2) Якщо це прямо-файловий URL — спробуємо зберегти в R2 (неблокуюче для тексту)
      if (payload?.url && shouldTryStoreToR2ByMeta(extracted)) {
        const name = payload?.name || fileNameFromPath(new URL(payload.url).pathname) || "file";
        const putRes = await tryStoreToR2(env, payload.url, name);
        if (putRes?.ok) { r2Key = putRes.key; r2Size = putRes.size || 0; }
        else { meta.r2Note = putRes?.error || "failed to store to R2"; }
      }
    } else {
      // Фолбек: як у попередній версії — спроба зберегти файл якщо схоже на файл
      src = payload?.url || payload?.name || "unknown";
      title = payload?.name || guessHumanTitleFromUrlSafe(payload?.url) || "матеріал";
      meta = { type: "url", note: extracted?.error || "extract_failed" };

      if (payload?.url) {
        const u = safeUrl(payload.url);
        if (u && looksLikeFileByPath(u.pathname)) {
          const name = payload?.name || fileNameFromPath(u.pathname) || "file";
          const putRes = await tryStoreToR2(env, u.toString(), name);
          if (putRes?.ok) { r2Key = putRes.key; r2Size = putRes.size || 0; }
          else { meta.r2Note = putRes?.error || "failed to store to R2"; }
        }
      }
    }
  }

  // 2) Якщо це payload типу "file" (без url) — просто збережемо мета; R2 робиться в місці отримання URL
  if (!title) {
    src = payload?.name || "file";
    title = payload?.name || "файл";
    meta.type = meta.type || "file";
  }

  // 3) Людяний інсайт
  const typeUa = humanTypeUa(meta.type);
  const insight = `Вивчено: ${title}${typeUa ? ` (${typeUa})` : ""}`;

  const learnedObj = {
    id: item.id,
    userId,
    kind,
    src,
    title,
    meta,
    at: nowIso(),
    r2Key: r2Key || undefined,
    r2Size: r2Size || undefined,
    insight,
    // ✨ нове:
    summary: summary || undefined,
    bullets: bullets && bullets.length ? bullets : undefined,
  };
  await saveLearned(env, learnedObj);

  return { kind, src, learned: true, insight, r2Key, r2Size, summary, bullets };
}

// ---------------- LLM summarize ----------------

/**
 * Викликає LLM для узагальнення контенту по чанках:
 *  - робить коротке summary кожного чанка (1–2 речення)
 *  - фінальне зведення + 5–10 булітів
 */
async function summarizeChunksWithLLM(env, { title, chunks, lang = "uk" }) {
  const MAX_CHUNKS = Math.min(chunks.length, Number(env.LEARN_MAX_CHUNKS || 8));
  const use = chunks.slice(0, MAX_CHUNKS);

  // 1) Summary для кожного чанка (стисле)
  const per = [];
  for (let i = 0; i < use.length; i++) {
    const piece = String(use[i] || "").slice(0, 4000);
    const prompt =
`Ти — уважний науковий редактор. На вхід — фрагмент матеріалу.
Стисло перекажи суть цього фрагмента 1–2 реченнями. Без "води". Пиши ${lang}.

Фрагмент:
"""${piece}"""`;
    const out = await callLLM(env, prompt, { lang });
    per.push(out.trim());
  }

  // 2) Фінальне зведення
  const joinPer = per.map((s, i) => `#${i + 1}: ${s}`).join("\n");
  const finalPrompt =
`Ти — редактор-конспектолог. Є короткі резюме частин матеріалу під назвою "${title || "матеріал"}".
Побудуй:
1) Підсумкове резюме на 5–7 речень (${lang}).
2) 5–10 маркованих булітів з найважливішими тезами (${lang}).

Резюме частин:
${joinPer}`;

  const finalOut = await callLLM(env, finalPrompt, { lang });
  const { summary, bullets } = splitSummaryBullets(finalOut, { lang });
  return { summary, bullets };
}

function splitSummaryBullets(text, { lang = "uk" } = {}) {
  const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const bullets = [];
  const body = [];
  for (const l of lines) {
    if (/^[-•*]\s+/.test(l)) bullets.push(l.replace(/^[-•*]\s+/, "").trim());
    else body.push(l);
  }
  const summary = body.join(" ").replace(/\s{2,}/g, " ").trim();
  return { summary, bullets };
}

async function callLLM(env, userText, { lang = "uk" } = {}) {
  const system = `You are Senti — concise helpful summarizer. Write only in ${lang}.`;
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  try {
    if (modelOrder) {
      return await askAnyModel(env, modelOrder, userText, { systemHint: system });
    }
  } catch (e) {
    // fall back to think
  }
  return await think(env, userText, system);
}

// ---------------- helpers ----------------

function safeUrl(u) { try { return new URL(u); } catch { return null; } }
function fileNameFromPath(p) {
  try { return decodeURIComponent((p || "").split("/").filter(Boolean).pop() || "file"); } catch { return "file"; }
}
function guessHumanTitleFromUrlSafe(u) {
  try {
    const U = new URL(u);
    const last = fileNameFromPath(U.pathname || "");
    return last || U.hostname;
  } catch { return "матеріал"; }
}
function humanTypeUa(type) {
  switch (type) {
    case "youtube": return "відео YouTube";
    case "telegram-file": return "файл з Telegram";
    case "file": return "файл";
    case "web-article": return "стаття";
    case "article": return "стаття";
    case "text": return "текст";
    case "note": return "нотатка";
    case "pdf": return "PDF";
    case "zip": return "архів";
    default: return "";
  }
}

async function tryStoreToR2(env, url, name = "file") {
  const bucket = r2(env);
  if (!bucket) return { ok: false, error: "LEARN_BUCKET is not bound" };

  let resp;
  try { resp = await fetch(url, { method: "GET" }); }
  catch (e) { return { ok: false, error: `fetch failed: ${String(e?.message || e)}` }; }

  if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };

  const arrBuf = await resp.arrayBuffer();
  const size = arrBuf.byteLength || 0;
  const mime = resp.headers.get("content-type") || "application/octet-stream";

  const key = `learn/${new Date().toISOString().slice(0,10)}/${Date.now()}_${safeName(name)}`;
  try {
    await bucket.put(key, arrBuf, { httpMetadata: { contentType: mime } });
  } catch (e) {
    return { ok: false, error: `r2.put failed: ${String(e?.message || e)}` };
  }
  return { ok: true, key, size, sizePretty: bytesFmt(size) };
}
function safeName(n) { return String(n || "file").replace(/[^\w.\-]+/g, "_").slice(0, 140); }

function makeSummary(results) {
  if (!results?.length) return "✅ Черга порожня — немає нових матеріалів.";
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const lines = [];
  if (ok.length) {
    lines.push(`🧠 Вивчено: ✅ Опрацьовано: ${ok.length}`);
    ok.slice(0, 5).forEach((r, i) => {
      const add = r.r2Key ? ` — збережено у R2` : "";
      const sum = r.summary ? " • має резюме" : "";
      lines.push(`  ${i + 1}) ${r.insight}${add}${sum}`);
    });
    if (ok.length > 5) lines.push(`  ... та ще ${ok.length - 5}`);
  }
  if (fail.length) {
    lines.push(`⚠️ З помилками: ${fail.length}`);
    fail.slice(0, 3).forEach((r, i) => {
      lines.push(`  - ${i + 1}) ${r.error}`);
    });
    if (fail.length > 3) lines.push(`  ... та ще ${fail.length - 3}`);
  }
  return lines.join("\n");
}

function looksLikeFileByPath(path) {
  const p = (path || "").toLowerCase();
  return /\.(zip|7z|rar|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|mp4|mov|webm|txt|md|csv)(?:$|\?)/i.test(p);
}

function chunkText(s, size = 4000) {
  // локальний fallback, але переважно беремо з extractors.js
  const out = [];
  let t = String(s || "");
  while (t.length) {
    out.push(t.slice(0, size));
    t = t.slice(size);
  }
  return out;
}