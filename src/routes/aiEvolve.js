// src/routes/aiEvolve.js
// Порівняння версій "мозку" + авто-промоут з декількома fallback-способами.

import { listArchives, appendChecklist } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** Абсолютне посилання від baseOrigin + (за наявності) підклеюємо секрет ?s= */
const withSecFrom = (env, baseOrigin, path) => {
  const u = new URL(path, baseOrigin);
  const s = env.WEBHOOK_SECRET || "";
  if (s && !u.searchParams.has("s")) u.searchParams.set("s", s);
  return u.toString();
};

async function safeJson(url, init) {
  try {
    const r = await fetch(url, {
      // невеличкі дефолти, які не заважають переозначити в init
      headers: { accept: "application/json", ...(init?.headers || {}) },
      ...init,
    });
    const d = await r.json().catch(() => ({}));
    return {
      ok: r.ok,
      status: r.status,
      data: d,
      url: typeof url === "string" ? url : url.toString(),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { error: String(e) },
      url: typeof url === "string" ? url : url.toString(),
    };
  }
}

async function getCurrentKey(env, origin) {
  const u = withSecFrom(env, origin, "/api/brain/current");
  const r = await safeJson(u);
  // очікуємо { ok:true, current:"<key>" } або { ok:true, key:"<key>" }
  return r.data?.current || r.data?.key || null;
}

export async function handleAiEvolve(req, env, url) {
  const p = url.pathname;

  // GET /ai/evolve/run — бере 2 останні архіви і записує коротке резюме у чеклист
  if (p === "/ai/evolve/run" && req.method === "GET") {
    const items = await listArchives(env);
    if (!Array.isArray(items) || items.length < 2) {
      return json(
        { ok: false, error: "not_enough_archives", total: items?.length || 0 },
        400
      );
    }
    // очікуємо, що listArchives повертає від новішого до старішого
    const [current, previous] = [items[0], items[1]];
    const msg = `🧠 evolution: ${previous} > ${current}`;
    await appendChecklist(env, msg);
    return json({
      ok: true,
      message: "evolution summary saved",
      compared: { previous, current },
    });
  }

  // GET /ai/evolve/auto — selftest → promote (найновіший не-current архів)
  if (p === "/ai/evolve/auto" && req.method === "GET") {
    const mk = (path) => withSecFrom(env, url.origin, path);

    // 1) selftest (із секретом)
    const st = await safeJson(mk("/selftest/run"));
    const stOk = !!st.ok && !!st.data?.ok;

    // 2) список архівів
    const items = await listArchives(env);
    if (!Array.isArray(items) || items.length === 0) {
      const line = "❌ auto-promote skipped — no archives";
      await appendChecklist(env, line);
      return json({ ok: false, error: "no_archives" }, 400);
    }

    // 3) визначаємо current і обираємо кандидат на промоут
    const currentKey = await getCurrentKey(env, url.origin).catch(() => null);

    // перший, що відрізняється від current; якщо всі однакові — немає сенсу промоутити
    let key = items.find((k) => k && k !== currentKey) || null;

    if (!key) {
      const line = `ℹ️ auto-promote skipped — nothing new to promote (current=${currentKey || "null"})`;
      await appendChecklist(env, line);
      return json(
        { ok: true, skipped: true, reason: "nothing_new", current: currentKey },
        200
      );
    }

    // 4) робимо кілька спроб промоуту
    const tries = [];

    // try #1: GET із query (?key=...)
    {
      const getUrl = mk(`/api/brain/promote?key=${encodeURIComponent(key)}`);
      const r1 = await safeJson(getUrl);
      tries.push({
        method: "GET_QUERY_DEFAULT",
        url: r1.url,
        status: r1.status,
        ok: r1.ok,
      });
      if (r1.ok) {
        const line = `🧠 auto-promote success → ${key} [GET_QUERY ${r1.status}]${
          stOk ? "" : " (selftest:fail)"
        }`;
        await appendChecklist(env, line);
        return json({
          ok: true,
          selftest_ok: stOk,
          promoted: r1.data?.promoted || key,
          status: r1.status,
          method: "GET_QUERY",
        });
      }
    }

    // try #2: POST x-www-form-urlencoded
    {
      const postFormUrl = mk("/api/brain/promote");
      const r2 = await safeJson(postFormUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key }),
      });
      tries.push({
        method: "POST_FORM",
        url: r2.url,
        status: r2.status,
        ok: r2.ok,
      });
      if (r2.ok) {
        const line = `🧠 auto-promote success → ${key} [POST_FORM ${r2.status}]${
          stOk ? "" : " (selftest:fail)"
        }`;
        await appendChecklist(env, line);
        return json({
          ok: true,
          selftest_ok: stOk,
          promoted: r2.data?.promoted || key,
          status: r2.status,
          method: "POST_FORM",
        });
      }
    }

    // try #3: POST JSON
    {
      const postJsonUrl = mk("/api/brain/promote");
      const r3 = await safeJson(postJsonUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      tries.push({
        method: "POST_JSON",
        url: r3.url,
        status: r3.status,
        ok: r3.ok,
      });
      if (r3.ok) {
        const line = `🧠 auto-promote success → ${key} [POST_JSON ${r3.status}]${
          stOk ? "" : " (selftest:fail)"
        }`;
        await appendChecklist(env, line);
        return json({
          ok: true,
          selftest_ok: stOk,
          promoted: r3.data?.promoted || key,
          status: r3.status,
          method: "POST_JSON",
        });
      }

      // Усі спроби провалилися — лог та відповідь
      const line =
        `⚠️ auto-promote fail → ${key} ` +
        `[${tries.map((t) => `${t.method} ${t.status}`).join(" · ")}]` +
        (stOk ? "" : " (selftest:fail)");
      await appendChecklist(env, line);

      return json(
        {
          ok: false,
          selftest_ok: stOk,
          promoted: key,
          status: r3.status,
          method: "FAILED",
          tried: tries,
          current: currentKey || null,
        },
        500
      );
    }
  }

  return null;
}