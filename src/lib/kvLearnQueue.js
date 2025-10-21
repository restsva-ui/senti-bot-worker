// src/lib/kvLearnQueue.js
/**
 * Learn queue + реальне збереження у R2 й інсайти/самарі у KV.
 *
 * KV keys:
 *   - learn:q:<ts>:<rand>        -> JSON item { id, userId, kind, payload, at, status }
 *   - learn:last_summary         -> короткий підсумок останнього прогону runner'a
 *   - learned:<ts>:<id>          -> JSON learned item {
 *         id, userId, kind, src, title, at,
 *         meta, r2Key?, r2Size?, insight, summary?, topics?, type?
 *     }
 *
 * Feature flags / ENV:
 *   - LEARN_ENABLED ("on" / "off")
 *   - LEARN_BUCKET (R2 binding) — якщо немає, файли не зберігаємо
 *   - MODEL_ORDER (загальний порядок моделей)
 *   - LEARN_SUMMARY_MODEL_ORDER (спеціальний порядок для самарі; має пріоритет)
 */

import { fetchAndExtract, chunkText as chunkTextLocal } from "./extractors.js";
import { askAnyModel } from "./modelRouter.js";
import { think } from "./brain.js";

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
  if (payload?.file || payload?.blob || payload?.name?.match?.(/\.(zip|rar|7z|pdf|docx|txt|md|csv|json|png|jpg|jpeg|mp4|mov)$/i)) return "file";
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

// ────────────────────────────────────────────────────────────────────────────
// Основний Runner (оновлений): витягає вміст, робить самарі/інсайти, кладе файли у R2
// ────────────────────────────────────────────────────────────────────────────

export async function runLearnOnce(env, { maxItems = 8 } = {}) {
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
      const res = await learnItemEnhanced(env, item);
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

/**
 * === learnItemEnhanced ===
 * 1) Визначає джерело
 * 2) Тягне вміст через fetchAndExtract (HTML→текст, TXT/MD→текст, YouTube→мета, PDF/ZIP→мета)
 * 3) Для файлів/прямих URL (якщо R2 bound) — зберігає сирий файл у R2
 * 4) Робить LLM-самарі + інсайти по чанках, формує "summary" (2–5 речень) і "topics" (теги)
 * 5) Зберігає learned:* у KV
 */
async function learnItemEnhanced(env, item) {
  const { kind, payload, userId } = item;

  // 0) Витягнути вміст
  const ext = await fetchAndExtract(env, payload);
  if (!ext?.ok) throw new Error(`extract_fail: ${ext?.error || "unknown"}`);

  const type = ext.type; // article | text | inline-text | youtube | pdf | zip | binary
  const src = payload?.url || payload?.name || ext?.meta?.url || "unknown";
  const title = ext.title || payload?.name || "матеріал";
  const meta = ext.meta || {};

  let r2Key = null;
  let r2Size = 0;

  // 1) Якщо це файл/прямий файл по URL і є R2 — спробувати зберегти
  if (shouldTryR2(type, payload)) {
    const putRes = await tryStoreToR2(env, payload?.url, payload?.name || title, meta?.contentType);
    if (putRes?.ok) {
      r2Key = putRes.key;
      r2Size = putRes.size || 0;
    } else {
      meta.r2Note = putRes?.error || "failed to store to R2";
    }
  }

  // 2) Якщо маємо текстові chunks — згенерувати самарі/інсайти
  let insight = makeSimpleInsight(title, type, !!r2Key);
  let summary = "";
  let topics = [];

  if (Array.isArray(ext.chunks) && ext.chunks.length) {
    const llm = chooseModelOrder(env);
    const pieces = [];
    const tagsSet = new Set();

    // короткий промпт для кожного чанка
    for (const ch of ext.chunks.slice(0, 8)) { // стеля для вартості
      const prompt = makeChunkPrompt(title, src, ch);
      const out = await callLLM(env, llm, prompt);
      const parsed = parseMini(out);
      if (parsed?.summary) pieces.push(parsed.summary);
      (parsed?.topics || []).forEach(t => tagsSet.add(t));
    }

    summary = coalesceSummary(pieces, title);
    topics = Array.from(tagsSet).slice(0, 10);
    if (summary) {
      insight = buildInsightFromSummary(title, type, summary, topics, !!r2Key);
    }
  }

  // 3) Зберегти learned
  const learnedObj = {
    id: item.id,
    userId,
    kind,
    src,
    title,
    at: nowIso(),
    type,
    meta,
    r2Key: r2Key || undefined,
    r2Size: r2Size || undefined,
    insight,
    summary,
    topics,
  };
  await saveLearned(env, learnedObj);

  return { type, src, learned: true, insight, summary, topics, r2Key, r2Size };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (LLM, R2, prompts)
// ────────────────────────────────────────────────────────────────────────────

function shouldTryR2(type, payload) {
  if (!payload?.url) return false;
  // якщо це явно текст/стаття — R2 не потрібен
  if (type === "article" || type === "text" || type === "inline-text" || type === "youtube") return false;
  // pdf/zip/binary — так
  return true;
}

function chooseModelOrder(env) {
  // окремий порядок для learn-самарі або загальний
  return String(env.LEARN_SUMMARY_MODEL_ORDER || env.MODEL_ORDER || "").trim();
}

async function callLLM(env, modelOrder, prompt, { systemHint = "" } = {}) {
  // Якщо заданий порядок через router — використовуємо його
  if (modelOrder) {
    try { return await askAnyModel(env, modelOrder, prompt, { systemHint }); }
    catch { /* fallthrough */ }
  }
  // Інакше — базовий think (Gemini/CF/OpenRouter/Free)
  return await think(env, prompt, systemHint);
}

function makeChunkPrompt(title, src, chunk) {
  return [
    `Ти — стислий науково-практичний референт.`,
    `Назва матеріалу: "${title}".`,
    `Джерело: ${src}.`,
    `Завдання:`,
    `1) Дай короткий, емкий summary цього фрагмента (2–3 речення).`,
    `2) Витягни до 5 ключових topics/тегів (одно-двохслівні, без дублікатів).`,
    `3) Формат відповіді (JSON): {"summary":"...","topics":["..."]}`,
    ``,
    `Фрагмент:`,
    chunk.slice(0, 3500),
  ].join("\n");
}

function parseMini(s = "") {
  // намагаємось дістати JSON
  try {
    const m = String(s).match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      if (typeof j?.summary === "string") {
        return { summary: j.summary.trim(), topics: Array.isArray(j.topics) ? j.topics.map(x => String(x).trim()).filter(Boolean) : [] };
      }
    }
  } catch {}
  // fallback: зрізаємо перші 2-3 речення
  const txt = String(s).replace(/\n+/g, " ").trim();
  const short = txt.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  return { summary: short, topics: [] };
}

function coalesceSummary(pieces, title) {
  const joined = pieces.filter(Boolean).join(" ");
  if (!joined) return "";
  // ще раз урізаємо
  const sentences = joined.split(/(?<=[.!?])\s+/).slice(0, 5).join(" ");
  // невелике форматування
  return sentences.length > 800 ? (sentences.slice(0, 780) + "…") : sentences;
}

function makeSimpleInsight(title, type, hasR2) {
  const typeUa = humanTypeUa(type);
  return `Вивчено: ${title}${typeUa ? ` (${typeUa})` : ""}${hasR2 ? " — збережено у R2" : ""}`;
}

function buildInsightFromSummary(title, type, summary, topics = [], hasR2) {
  const base = makeSimpleInsight(title, type, hasR2);
  const tags = topics.length ? ` Теги: ${topics.slice(0,5).join(", ")}.` : "";
  return `${base}\nКоротко: ${summary}${tags}`;
}

function humanTypeUa(type) {
  switch (type) {
    case "youtube": return "відео YouTube";
    case "pdf": return "PDF";
    case "zip": return "архів";
    case "article": return "стаття";
    case "text": return "текст";
    case "inline-text": return "нотатка";
    case "binary": return "файл";
    default: return "";
  }
}

async function tryStoreToR2(env, url, name = "file", contentTypeHint) {
  const bucket = r2(env);
  if (!bucket) return { ok: false, error: "LEARN_BUCKET is not bound" };
  if (!url) return { ok: false, error: "no url" };

  let resp;
  try { resp = await fetch(url, { method: "GET" }); }
  catch (e) { return { ok: false, error: `fetch failed: ${String(e?.message || e)}` }; }

  if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };

  const arrBuf = await resp.arrayBuffer();
  const size = arrBuf.byteLength || 0;
  const mime = contentTypeHint || resp.headers.get("content-type") || "application/octet-stream";

  const key = `learn/${new Date().toISOString().slice(0,10)}/${Date.now()}_${safeName(name)}`;
  try {
    await bucket.put(key, arrBuf, { httpMetadata: { contentType: mime } });
  } catch (e) {
    return { ok: false, error: `r2.put failed: ${String(e?.message || e)}` };
  }
  return { ok: true, key, size, sizePretty: bytesFmt(size) };
}

function safeName(n) { return String(n || "file").replace(/[^\w.\-]+/g, "_").slice(0, 140); }

// ────────────────────────────────────────────────────────────────────────────
// Підсумок для HTML/UI
// ────────────────────────────────────────────────────────────────────────────
function makeSummary(results) {
  if (!results?.length) return "✅ Черга порожня — немає нових матеріалів.";
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const lines = [];
  if (ok.length) {
    lines.push(`🧠 Вивчено: ✅ Опрацьовано: ${ok.length}`);
    ok.slice(0, 5).forEach((r, i) => {
      const add = r.r2Key ? ` — збережено у R2` : "";
      lines.push(`  ${i + 1}) ${r.insight?.split?.("\n")?.[0] || r.insight || r.title}${add}`);
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