// src/routes/adminRepo.js
import { listArchives, getArchive, deleteArchive } from "../lib/kvChecklist.js";
import { html, json } from "../utils/respond.js";
import { abs } from "../utils/url.js";

/**
 * Адмін-інтерфейс для архівів (Repo)
 * GET:
 *   • /admin/repo/html — список архівів + дії Promote / Rollback
 *   • /admin/archive/get?key=...
 *   • /admin/archive/delete?key=...
 *   • /admin/archive/promote?key=...
 *   • /admin/archive/rollback
 */

const CURRENT_ARCHIVE_KEY = "senti_repo_current";
const HISTORY_KEY         = "senti_repo_history";

// Використовуємо те саме KV, що й чеклист/архіви (в kvChecklist.js воно — TODO_KV)
function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing (wrangler.toml)!");
  return kv;
}

async function getCurrent(env) {
  const kv = ensureKv(env);
  return await kv.get(CURRENT_ARCHIVE_KEY);
}

async function setCurrent(env, key) {
  const kv = ensureKv(env);
  await kv.put(CURRENT_ARCHIVE_KEY, String(key || ""));
}

async function getHistory(env) {
  const kv = ensureKv(env);
  const raw = await kv.get(HISTORY_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setHistory(env, arr) {
  const kv = ensureKv(env);
  await kv.put(HISTORY_KEY, JSON.stringify(arr || []));
}

/** Додаємо попередній current у історію (LIFO), обмежуємо розмір, напр. до 20 */
async function pushHistory(env, prevKey) {
  if (!prevKey) return;
  const arr = await getHistory(env);
  // видаляємо дубль, якщо він уже є (щоб не плодити)
  const filtered = arr.filter(k => k !== prevKey);
  filtered.unshift(prevKey);
  if (filtered.length > 20) filtered.length = 20;
  await setHistory(env, filtered);
}

/** Витягуємо наступний кандидат на rollback */
async function popHistory(env) {
  const arr = await getHistory(env);
  const next = arr.shift(); // LIFO
  await setHistory(env, arr);
  return next || null;
}

export async function handleAdminRepo(req, env, url) {
  const p = url.pathname;
  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  // ---------- UI: список архівів + Promote / Rollback ----------
  if (p === "/admin/repo/html") {
    if (needSecret()) return html("<h3>401</h3>");
    const keys = await listArchives(env);
    const current = await getCurrent(env);
    const history = await getHistory(env);

    const withSec = (base, hasQuery = false) =>
      !env.WEBHOOK_SECRET
        ? base
        : base + (hasQuery ? "&" : "?") + "s=" + encodeURIComponent(env.WEBHOOK_SECRET);

    const list =
      keys
        .map((k) => {
          const key = encodeURIComponent(k);
          const hrefGet    = withSec(`/admin/archive/get?key=${key}`, true);
          const hrefDel    = withSec(`/admin/archive/delete?key=${key}`, true);
          const hrefProm   = withSec(`/admin/archive/promote?key=${key}`, true);

          const isCurrent  = (k === current);
          const badge = isCurrent
            ? `<span style="color:#0a0; font-weight:600; margin-left:6px;">(current)</span>`
            : ``;

          // Кнопку Promote не показуємо для вже current
          const actions = [
            `<a href="${hrefGet}">⬇️</a>`,
            !isCurrent ? `<a href="${hrefProm}" onclick="return confirm('Promote this snapshot?')">🟩 Promote</a>` : ``,
            `<a href="${hrefDel}" onclick="return confirm('Delete this snapshot?')">🗑</a>`
          ].filter(Boolean).join(" &nbsp; ");

          return `<li style="margin:6px 0;">
            <code>${k}</code> ${badge}
            <div style="display:inline-block; margin-left:10px">${actions}</div>
          </li>`;
        })
        .join("") || "<li>Порожньо</li>";

    const backChecklist = withSec("/admin/checklist/html");

    const rollbackHref = withSec("/admin/archive/rollback");
    const rollbackBtn = history.length
      ? `<a href="${rollbackHref}" class="pill" onclick="return confirm('Rollback to previous green snapshot?')">🔁 Rollback</a>`
      : `<span class="pill" style="opacity:.5; pointer-events:none">🔁 Rollback (історія порожня)</span>`;

    return html(`<!doctype html>
<meta charset="utf-8">
<title>Repo</title>
<style>
  body{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:20px}
  .pill{display:inline-block; padding:6px 10px; border:1px solid #ddd; border-radius:999px; background:#fff; text-decoration:none}
  code{background:#f6f7f9; padding:2px 6px; border-radius:6px}
</style>
<div style="max-width:900px">
  <h2>📚 Архів (Repo)</h2>

  <div style="margin:10px 0">
    <a class="pill" href="${backChecklist}">⬅ До Checklist</a>
    ${rollbackBtn}
  </div>

  <div style="margin:10px 0; padding:10px; background:#f6fff6; border:1px solid #e2f5e2; border-radius:8px">
    <div><b>Current:</b> ${
      current
        ? `<code>${current}</code>`
        : `<span style="color:#c00">не встановлено</span>`
    }</div>
    <div style="margin-top:6px"><b>History:</b> ${
      history.length
        ? history.map(k=>`<code>${k}</code>`).join(", ")
        : "<i>порожньо</i>"
    }</div>
  </div>

  <ul style="list-style: none; padding-left:0">${list}</ul>
</div>`);
  }

  // ---------- GET: завантажити архів ----------
  if (p === "/admin/archive/get") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key required" }, 400);
    const b64 = await getArchive(env, key);
    if (!b64) return json({ ok: false, error: "not found" }, 404);
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bin, {
      headers: { "content-type": "application/octet-stream" },
    });
  }

  // ---------- DELETE: видалити архів ----------
  if (p === "/admin/archive/delete") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key required" }, 400);

    // Якщо видаляємо current — знімаємо current-прапорець
    const current = await getCurrent(env);
    if (current && current === key) {
      await setCurrent(env, "");
    }

    // Також прибираємо із історії, якщо такий там є
    const hist = await getHistory(env);
    const filtered = hist.filter(k => k !== key);
    if (filtered.length !== hist.length) await setHistory(env, filtered);

    await deleteArchive(env, key);
    return Response.redirect(
      abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
      302
    );
  }

  // ---------- PROMOTE: зробити архів поточним ----------
  if (p === "/admin/archive/promote") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key required" }, 400);

    // Переконаємось, що архів існує
    const b64 = await getArchive(env, key);
    if (!b64) return json({ ok:false, error:"archive not found" }, 404);

    // Поточний → у історію
    const prev = await getCurrent(env);
    if (prev && prev !== key) {
      await pushHistory(env, prev);
    }

    // Встановити новий current
    await setCurrent(env, key);

    return Response.redirect(
      abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
      302
    );
  }

  // ---------- ROLLBACK: відкотитись до попереднього зі стеку ----------
  if (p === "/admin/archive/rollback") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);

    const next = await popHistory(env);
    if (!next) {
      // нічого в історії — просто назад
      return Response.redirect(
        abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
        302
      );
    }

    // упевнимось, що архів існує (можливо його уже видалили)
    const b64 = await getArchive(env, next);
    if (!b64) {
      // архів втрачено — шукай наступний в історії (поки не знайдемо або історія не спорожніє)
      let candidate = next;
      while (candidate && !(await getArchive(env, candidate))) {
        candidate = await popHistory(env);
      }
      if (!candidate) {
        await setCurrent(env, "");
        return Response.redirect(
          abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
          302
        );
      }
      await setCurrent(env, candidate);
      return Response.redirect(
        abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
        302
      );
    }

    // усе добре — ставимо candidate як current
    await setCurrent(env, next);
    return Response.redirect(
      abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
      302
    );
  }

  return null; // не наш маршрут
}