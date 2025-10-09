// src/lib/adminChecklist.js
// Маршрути адмін-чеκлиста поверх KV з безпечним error handling
import {
  readChecklist,
  writeChecklist,
  appendChecklist,
  saveArchive,
  getArchive,
  checklistHtml,
} from "./kvChecklist.js";

function html(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function text(s, status = 200) {
  return new Response(String(s), {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Захист за секретом: ?s=<WEBHOOK_SECRET>
function checkSecret(url, env) {
  const s = url.searchParams.get("s") || "";
  return s && env.WEBHOOK_SECRET && s === env.WEBHOOK_SECRET;
}

/**
 * Головний роутер для /admin/checklist/*
 * Повертає Response або null (коли шлях не наш).
 */
export async function routeAdminChecklist(req, env, url) {
  const p = url.pathname;

  if (!p.startsWith("/admin/checklist")) return null;

  // тільки адмін (по секрету)
  if (!checkSecret(url, env)) {
    return html("<h3>Forbidden</h3><p>Invalid secret.</p>", 403);
  }

  try {
    // GET: HTML редактор
    if (p === "/admin/checklist/html") {
      const page = await checklistHtml(env, url.searchParams.get("s") || "");
      return html(page);
    }

    // POST: додати рядок
    if (p === "/admin/checklist/append" && req.method === "POST") {
      const fd = await req.formData();
      const line = (fd.get("line") || "").toString().trim();
      if (!line) return html("<p>Порожній рядок.</p>", 400);
      await appendChecklist(env, line);
      return html('<meta http-equiv="refresh" content="0;url=../html?s=' + encodeURIComponent(url.searchParams.get("s") || "") + '">');
    }

    // POST: зберегти весь текст
    if (p === "/admin/checklist/save" && req.method === "POST") {
      const fd = await req.formData().catch(() => null);
      let body = "";
      if (fd && fd.get("body") != null) {
        body = fd.get("body").toString();
      } else {
        // як fallback — читаємо сирий body
        body = await req.text();
      }
      await writeChecklist(env, body);
      return html('<meta http-equiv="refresh" content="0;url=../html?s=' + encodeURIComponent(url.searchParams.get("s") || "") + '">');
    }

    // POST: завантажити файл в архіви KV
    if (p === "/admin/checklist/upload" && req.method === "POST") {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return html("<p>Файл не надіслано.</p>", 400);
      }
      const meta = await saveArchive(env, file);
      await appendChecklist(env, `uploaded ${meta.name} (${meta.size} B)`);
      return html('<meta http-equiv="refresh" content="0;url=../html?s=' + encodeURIComponent(url.searchParams.get("s") || "") + '">');
    }

    // GET: завантажити архів назад з KV
    if (p === "/admin/checklist/archive") {
      const key = url.searchParams.get("id") || "";
      if (!key) return html("<p>id обов'язковий</p>", 400);
      const obj = await getArchive(env, key);
      if (!obj) return html("<p>Не знайдено</p>", 404);
      return new Response(obj.buf, {
        status: 200,
        headers: {
          "content-type": obj.ct,
          "content-disposition": `attachment; filename="${encodeURIComponent(obj.name)}"`,
        },
      });
    }

    // Якщо шлях невідомий — 404
    return html("<h3>Not found</h3>", 404);
  } catch (err) {
    // детальний текст помилки (щоб не було 1101)
    const msg = (err && err.stack) ? err.stack : String(err);
    return html(`<h3>Server error</h3><pre>${escapeHtml(msg)}</pre>`, 500);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}