/**
 * Learn queue + реальне збереження у R2 і інсайти у KV.
 *
 * KV keys:
 *   - learn:q:<ts>:<rand>        -> JSON item { id, userId, kind, payload, at, status }
 *   - learn:last_summary         -> короткий підсумок останнього прогону
 *   - learned:<ts>:<id>          -> JSON learned item { id, userId, kind, src, title, meta, at, r2RawKey?, r2TxtKey?, r2JsonKey?, r2Size?, insight }
 *
 * Feature flag:
 *   - env.LEARN_ENABLED ("on" / "off")
 *
 * Опціональні залежності:
 *   - env.LEARN_BUCKET  (R2 bucket) — якщо є, кладемо сирці/текст/чанки
 *
 * Нове:
 *   - Інтеграція з /src/lib/extractors.js (HTML/YouTube/текст)
 *   - Чанкінг тексту та збереження в R2 (JSON-масив)
 *   - Людяні інсайти в KV, використовується у System Prompt (getRecentInsights)
 */

import { extractFromUrl, chunkText as chunkTextForIndex, bytesFmt } from "./extractors.js";

const Q_PREFIX = "learn:q:";
const K_LAST_SUMMARY = "learn:last_summary";
const L_PREFIX = "learned:";

function enabled(env) {
  return String(env?.LEARN_ENABLED || "on").toLowerCase() !== "off";
}
function kv(env) {
  const v = env?.LEARN_QUEUE_KV;
  if (!v) throw new Error("LEARN_QUEUE_KV is not bound");
  return v;
}
function r2(env) {
  return env?.LEARN_BUCKET || null; // опціонально
}

function id() { return Math.random().toString(36).slice(2) + "-" + Date.now(); }
function nowIso() { return new Date().toISOString(); }

function safeUrl(u) { try { return new URL(u); } catch { return null; } }
function fileNameFromPath(p) {
  try { return decodeURIComponent((p || "").split("/").filter(Boolean).pop() || "file"); } catch { return "file"; }
}
function safeName(n) { return String(n || "file").replace(/[^\w.\-]+/g, "_").slice(0, 140); }

function detectKind(payload) {
  if (payload?.url) return "url";
  if (payload?.file || payload?.blob || payload?.name?.match?.(/\.(zip|rar|7z|pdf|docx?|xlsx?|pptx?|txt|md|csv|json|png|jpg|jpeg|mp4|mov)$/i)) return "file";
  if (payload?.text) return "text";
  return "unknown";
}

/** Публічне: додати будь-що у чергу */
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
async function del(env, key) { try { await kv(env).delete(key); } catch {} }

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

/** Підсумок для HTML/UI */
function makeSummary(results) {
  if (!results?.length) return "✅ Черга порожня — немає нових матеріалів.";
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const lines = [];
  if (ok.length) {
    lines.push(`🧠 Вивчено: ✅ Опрацьовано: ${ok.length}`);
    ok.slice(0, 5).forEach((r, i) => {
      const add = (r.r2RawKey || r.r2TxtKey || r.r2JsonKey) ? ` — збережено у R2` : "";
      lines.push(`  ${i + 1}) ${r.insight}${add}`);
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

/** Головний однопрохідний процесор */
export async function runLearnOnce(env, { maxItems = 10 } = {}) {
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
      const res = await learnItem(env, item);
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
 *  - якщо URL → пробуємо витягнути зміст (HTML/YouTube/текст)
 *  - текст → чанкуємо, кладемо текст і чанки в R2 (якщо є bucket)
 *  - будь-який файл/непідтримуваний тип → зберігаємо сире в R2
 *  - формуємо короткий людяний інсайт і пишемо в KV
 */
async function learnItem(env, item) {
  const { kind, payload, userId } = item;

  let src = payload?.url || payload?.name || "unknown";
  let title = payload?.name || "матеріал";
  let meta = { type: "unknown" };

  let r2RawKey = null;
  let r2TxtKey = null;
  let r2JsonKey = null;
  let r2Size = 0;

  // 1) URL → спробувати витягнути зміст
  if (kind === "url" && typeof payload?.url === "string") {
    const u = safeUrl(payload.url);
    if (u) {
      const host = u.hostname.toLowerCase();

      // Спробуємо універсальний екстрактор
      const extr = await extractFromUrl(u.toString());
      if (extr.ok && extr.text) {
        title = extr.title || title;
        meta.type = extr.kind || "text";
        src = extr.source || u.toString();

        // Збережемо текст і чанки в R2 (опціонально)
        const chunks = chunkTextForIndex(extr.text, { size: 1200, overlap: 200 });

        const bucket = r2(env);
        if (bucket) {
          const base = `learn/${new Date().toISOString().slice(0,10)}/${Date.now()}_${safeName(title)}`;

          // full text
          try {
            const txtKey = `${base}.txt`;
            await bucket.put(txtKey, extr.text, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
            r2TxtKey = txtKey;
            r2Size += (extr.text?.length || 0);
          } catch (e) {}

          // chunks as JSON
          try {
            const jsonKey = `${base}.chunks.json`;
            const json = JSON.stringify({ title, source: src, kind: meta.type, chunks }, null, 2);
            await bucket.put(jsonKey, json, { httpMetadata: { contentType: "application/json" } });
            r2JsonKey = jsonKey;
            r2Size += json.length;
          } catch (e) {}
        }

        // Людяний інсайт
        const insight = insightFrom(meta.type, title, src, chunks?.length || 0, r2TxtKey || r2JsonKey);
        const learnedObj = {
          id: item.id, userId, kind, src, title, meta, at: nowIso(),
          r2RawKey: r2RawKey || undefined,
          r2TxtKey: r2TxtKey || undefined,
          r2JsonKey: r2JsonKey || undefined,
          r2Size: r2Size || undefined,
          insight,
        };
        await saveLearned(env, learnedObj);
        return { kind, src, learned: true, insight, r2RawKey, r2TxtKey, r2JsonKey, r2Size };
      }

      // Якщо витягнути зміст не вийшло → спробуємо зберегти сирий файл у R2
      // Напр., прямий лінк на PDF/ZIP/відео тощо
      const name = payload?.name || fileNameFromPath(u.pathname) || "file";
      const putRes = await tryStoreRawToR2(env, u.toString(), name);
      meta.type = "file";
      title = name;
      if (putRes.ok) {
        r2RawKey = putRes.key;
        r2Size = putRes.size || 0;
      }

      const insight = `Збережено матеріал: ${title} (${host})${r2RawKey ? " — сире у R2" : ""}`;
      const learnedObj = {
        id: item.id, userId, kind, src, title, meta, at: nowIso(),
        r2RawKey: r2RawKey || undefined, r2Size: r2Size || undefined,
        insight,
      };
      await saveLearned(env, learnedObj);
      return { kind, src, learned: true, insight, r2RawKey, r2TxtKey, r2JsonKey, r2Size };
    }
  }

  // 2) Файл із URL (із черги/Telegram) → зберігаємо сире; якщо текст — добуваємо текст
  if (kind === "file" && payload?.url) {
    const u = safeUrl(payload.url);
    const name = payload?.name || (u && fileNameFromPath(u.pathname)) || "file";
    title = name; meta.type = "file"; src = payload?.url;

    // спроба як текст
    const extr = await extractFromUrl(payload.url);
    if (extr.ok && extr.text) {
      const chunks = chunkTextForIndex(extr.text, { size: 1200, overlap: 200 });
      const bucket = r2(env);
      if (bucket) {
        const base = `learn/${new Date().toISOString().slice(0,10)}/${Date.now()}_${safeName(name)}`;

        try {
          const txtKey = `${base}.txt`;
          await bucket.put(txtKey, extr.text, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
          r2TxtKey = txtKey;
          r2Size += (extr.text?.length || 0);
        } catch (e) {}

        try {
          const jsonKey = `${base}.chunks.json`;
          const json = JSON.stringify({ title: name, source: src, kind: "text", chunks }, null, 2);
          await bucket.put(jsonKey, json, { httpMetadata: { contentType: "application/json" } });
          r2JsonKey = jsonKey;
          r2Size += json.length;
        } catch (e) {}
      }
      meta.type = extr.kind || "text";
    } else {
      // якщо не текст → сире
      const putRes = await tryStoreRawToR2(env, payload.url, name);
      if (putRes.ok) { r2RawKey = putRes.key; r2Size = putRes.size || 0; }
    }

    const insight = insightFrom(meta.type, title, src, 0, r2TxtKey || r2JsonKey || r2RawKey);
    const learnedObj = {
      id: item.id, userId, kind, src, title, meta, at: nowIso(),
      r2RawKey: r2RawKey || undefined, r2TxtKey: r2TxtKey || undefined, r2JsonKey: r2JsonKey || undefined,
      r2Size: r2Size || undefined, insight,
    };
    await saveLearned(env, learnedObj);
    return { kind, src, learned: true, insight, r2RawKey, r2TxtKey, r2JsonKey, r2Size };
  }

  // 3) Інлайновий текст
  if (payload?.text) {
    title = payload?.name || "текст";
    meta.type = "note";
    const text = String(payload.text || "").trim();
    const chunks = chunkTextForIndex(text, { size: 1200, overlap: 200 });

    const bucket = r2(env);
    if (bucket) {
      const base = `learn/${new Date().toISOString().slice(0,10)}/${Date.now()}_${safeName(title)}`;
      try {
        const txtKey = `${base}.txt`;
        await bucket.put(txtKey, text, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
        r2TxtKey = txtKey;
        r2Size += text.length;
      } catch (e) {}
      try {
        const jsonKey = `${base}.chunks.json`;
        const json = JSON.stringify({ title, source: "inline-text", kind: "note", chunks }, null, 2);
        await bucket.put(jsonKey, json, { httpMetadata: { contentType: "application/json" } });
        r2JsonKey = jsonKey;
        r2Size += json.length;
      } catch (e) {}
    }

    const insight = `Вивчено нотатку: ${title}${r2TxtKey ? " (збережено у R2)" : ""}`;
    const learnedObj = {
      id: item.id, userId, kind, src: "inline-text", title, meta, at: nowIso(),
      r2TxtKey: r2TxtKey || undefined, r2JsonKey: r2JsonKey || undefined, r2Size: r2Size || undefined,
      insight,
    };
    await saveLearned(env, learnedObj);
    return { kind, src: "inline-text", learned: true, insight, r2RawKey, r2TxtKey, r2JsonKey, r2Size };
  }

  // 4) Фолбек
  const learnedObj = {
    id: item.id, userId, kind, src, title, meta, at: nowIso(),
    insight: `Додано матеріал (${meta.type}). Джерело: ${src}`,
  };
  await saveLearned(env, learnedObj);
  return { kind, src, learned: true, insight: learnedObj.insight, r2RawKey, r2TxtKey, r2JsonKey, r2Size };
}

// ---------------- helpers ----------------

function humanTypeUa(type) {
  switch (type) {
    case "youtube": return "відео YouTube (транскрипт)";
    case "web-article": return "стаття";
    case "text": return "текст";
    case "note": return "нотатка";
    case "file": return "файл";
    default: return type || "матеріал";
  }
}

function insightFrom(type, title, src, chunksCount = 0, storedKey = null) {
  const t = humanTypeUa(type);
  const base = `Вивчено: ${title}${t ? ` — ${t}` : ""}`;
  const c = chunksCount ? ` • чанків: ${chunksCount}` : "";
  const s = storedKey ? " • збережено у R2" : "";
  const host = (() => { try { return new URL(src).hostname; } catch { return ""; } })();
  const h = host ? ` • ${host}` : "";
  return `${base}${h}${c}${s}`;
}

async function tryStoreRawToR2(env, url, name = "file") {
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