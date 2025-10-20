// src/lib/kvLearnQueue.js
/**
 * Learn queue + реальне збереження у R2 і інсайти у KV.
 *
 * KV keys:
 *   - learn:q:<ts>:<rand>        -> JSON item { id, userId, kind, payload, at, status }
 *   - learn:last_summary         -> короткий підсумок останнього прогону
 *   - learned:<ts>:<id>          -> JSON learned item { id, userId, kind, src, title, meta, at, r2Key?, r2Size?, insight }
 *
 * Feature flag:
 *   - env.LEARN_ENABLED ("on" / "off")
 *
 * Опціональні залежності:
 *   - env.LEARN_BUCKET  (R2 bucket) — якщо не вказано, файли не зберігаємо, але пишемо інсайт
 */

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
  // Дуже легка евристика
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
  const list = await kv(env).list({ prefix: L_PREFIX, limit: 200 }); // невеликий запас
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
 *  - розпізнаємо джерело
 *  - для файлів/посилань на файли — зберігаємо в R2 (якщо прив’язано LEARN_BUCKET)
 *  - формуємо людяний інсайт, зберігаємо у KV (learned:*)
 */
async function learnItem(env, item) {
  const { kind, payload, userId } = item;
  let title = "";
  let src = "";
  let meta = { type: "unknown" };
  let r2Key = null;
  let r2Size = 0;

  if (kind === "url" && typeof payload?.url === "string") {
    src = payload.url;
    const u = safeUrl(payload.url);
    if (u) {
      const host = u.hostname.toLowerCase();

      // YouTube → не качаємо, але робимо нормальний опис
      if (host.includes("youtube.com") || host === "youtu.be") {
        meta.type = "youtube";
        title = guessHumanTitleFromUrl(u) || "YouTube відео";
      }

      // Telegram File → намагаємось зберегти в R2
      else if (host === "api.telegram.org" || host.endsWith(".telegram.org")) {
        meta.type = "telegram-file";
        const name = payload?.name || fileNameFromPath(u.pathname) || "file";
        const putRes = await tryStoreToR2(env, u.toString(), name);
        if (putRes?.ok) {
          r2Key = putRes.key;
          r2Size = putRes.size || 0;
          title = name;
        } else {
          title = name;
          meta.note = putRes?.error || "failed to store to R2";
        }
      }

      // Інші прямі файли (спробуємо розпізнати content-type, якщо невеликий)
      else if (/\.(zip|rar|7z|pdf|docx?|xlsx?|pptx?|txt|md|csv|png|jpe?g|gif|mp4|mov|webm)$/i.test(u.pathname)) {
        meta.type = "file";
        const name = payload?.name || fileNameFromPath(u.pathname) || "file";
        const putRes = await tryStoreToR2(env, u.toString(), name);
        if (putRes?.ok) {
          r2Key = putRes.key;
          r2Size = putRes.size || 0;
          title = name;
        } else {
          title = name;
          meta.note = putRes?.error || "failed to store to R2";
        }
      }

      // Веб-стаття (html) — просто опис, без завантаження
      else {
        meta.type = "web-article";
        title = guessHumanTitleFromUrl(u) || host;
      }
    } else {
      src = payload.url;
      title = payload?.name || "матеріал";
      meta.type = "url";
    }
  } else if (kind === "file") {
    src = payload?.name || "file";
    title = payload?.name || "file";
    meta.type = "file";
    // Якщо файл переданий як URL — теж кладемо в R2
    if (payload?.url) {
      const u = safeUrl(payload.url);
      if (u) {
        const putRes = await tryStoreToR2(env, u.toString(), title);
        if (putRes?.ok) { r2Key = putRes.key; r2Size = putRes.size || 0; }
        else { meta.note = putRes?.error || "failed to store to R2"; }
      }
    }
  } else if (payload?.text) {
    src = "inline-text";
    title = payload?.name || "текст";
    meta.type = "note";
  } else {
    src = payload?.name || "unknown";
    title = "матеріал";
    meta.type = "unknown";
  }

  // Людяний інсайт
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
  };
  await saveLearned(env, learnedObj);

  return { kind, src, learned: true, insight, r2Key, r2Size };
}

// ---------------- helpers ----------------

function safeUrl(u) { try { return new URL(u); } catch { return null; } }
function fileNameFromPath(p) {
  try { return decodeURIComponent((p || "").split("/").filter(Boolean).pop() || "file"); } catch { return "file"; }
}
function guessHumanTitleFromUrl(u) {
  const last = fileNameFromPath(u?.pathname || "");
  if (u.hostname === "youtu.be") return last || "YouTube відео";
  if (u.hostname.includes("youtube.com")) {
    const v = u.searchParams.get("v"); if (v) return v;
    return "YouTube відео";
  }
  return last || u.hostname;
}
function humanTypeUa(type) {
  switch (type) {
    case "youtube": return "відео YouTube";
    case "telegram-file": return "файл з Telegram";
    case "file": return "файл";
    case "web-article": return "стаття";
    case "note": return "нотатка";
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

/** Підсумок для HTML/UI */
function makeSummary(results) {
  if (!results?.length) return "✅ Черга порожня — немає нових матеріалів.";
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const lines = [];
  if (ok.length) {
    lines.push(`🧠 Вивчено: ✅ Опрацьовано: ${ok.length}`);
    ok.slice(0, 5).forEach((r, i) => {
      const add = r.r2Key ? ` — збережено у R2` : "";
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