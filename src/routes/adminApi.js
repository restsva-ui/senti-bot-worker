// src/routes/adminApi.js
import { json } from "../lib/utils.js";

/**
 * Простий guard: ?s=<WEBHOOK_SECRET>
 */
function assertSecret(req, env) {
  const url = new URL(req.url);
  const s = url.searchParams.get("s");
  if (!env.WEBHOOK_SECRET || s !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * У тебе вже є сторінка з архівами, тож десь існують допоміжні функції.
 * Якщо їх нема — тимчасово читаємо ключі з KV префіксу "archive:".
 */
async function listArchives(env) {
  try {
    // Варіант А: якщо архіви лежать у KV/Namespace STATE_KV з ключами типу "archive:checklist:<...>"
    const list = await env.STATE_KV.list({ prefix: "archive:" });
    // позначимо current: збережено під окремим ключем
    const cur = await env.STATE_KV.get("archive:current").catch(() => null);
    return (list.keys || []).map(k => ({
      name: k.name,
      current: cur && k.name === cur
    }));
  } catch {
    // Якщо в тебе інша реалізація — тут підставиш свій лістинг
    return [];
  }
}

export async function handleAdminApi(req, env) {
  const url = new URL(req.url);
  // guard
  const guard = assertSecret(req, env);
  if (guard) return guard;

  // /admin/api/ping
  if (url.pathname === "/admin/api/ping") {
    return json({ ok: true, pong: true, ts: Date.now() });
  }

  // /admin/api/list
  if (url.pathname === "/admin/api/list") {
    const items = await listArchives(env);
    return json({ ok: true, items });
  }

  return json({ ok: false, error: "not_found" }, { status: 404 });
}