// src/routes/aiImprove.js
// Нічний агент: читає коротку пам'ять LIKES_KV, робить стислий аналіз,
// зберігає інсайти у STATE_KV і пише нотатки у CHECKLIST_KV.
// Додано debug-ендпойнти для перевірки KV/часу + seed та аналіз одного ключа
// + bindings/checklist/insight debug.

import { askAnyModel } from "../lib/modelRouter.js";
import { appendChecklist as appendToChecklist } from "../lib/kvChecklist.js";

const INSIGHT_TTL = 60 * 60 * 24 * 14; // 14 днів
const MEM_PREFIX  = "u:";              // з memory.js: keyFor(chatId) -> u:<chatId>:mem

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// ---------- helpers ----------
function todayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

async function kvGetJSON(kv, key, defVal = null) {
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : defVal;
  } catch {
    return defVal;
  }
}
async function kvPutJSON(kv, key, val, ttlSec) {
  const body = JSON.stringify(val);
  await kv.put(key, body, ttlSec ? { expirationTtl: ttlSec } : undefined);
}

function buildSystemHint() {
  return (
    "Ти — внутрішній нічний агент Senti. " +
    "Отримаєш фрагменти діалогу (користувач/бот). " +
    "Поверни короткі інсайти українською у JSON-форматі:\n" +
    "{ \"summary\": \"1-2 речення суті\", " +
    "\"tone\": \"які відчуття/тон користувача\", " +
    "\"pain_points\": [\"ключові проблеми\"], " +
    "\"ideas\": [\"що покращити у відповідях\"], " +
    "\"rules\": [\"лаконічні поради боту, максимум 5\"] }\n" +
    "Без зайвого тексту, лише валідний JSON."
  );
}

function previewFromInsight(insight) {
  const sum = (insight?.analysis?.summary || "").replace(/\s+/g, " ").slice(0, 120);
  const rules = Array.isArray(insight?.analysis?.rules)
    ? insight.analysis.rules.slice(0, 2).join("; ")
    : "";
  return [sum, rules].filter(Boolean).join(" | ");
}

async function analyzeOneUser(env, chatId, state) {
  const messages = (state?.messages || []).slice(-20);
  if (messages.length === 0) return null;

  const compact = messages
    .map((m) => `${m.role === "user" ? "U" : "B"}: ${m.text}`)
    .join("\n")
    .slice(0, 8000);

  const prompt = "Ось останній контекст діалогу (U — user, B — bot):\n\n" + compact;

  let analysis;
  try {
    const out = await askAnyModel(env, `${buildSystemHint()}\n\n${prompt}`, {
      temperature: 0.2,
      max_tokens: 600,
    });

    // ---- robust clean → JSON ----
    let clean = out
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .replace(/\n+\[via[\s\S]*$/i, "")
      .trim();

    // вирізаємо чистий JSON між першою { і останньою }
    const first = clean.indexOf("{");
    const last  = clean.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      clean = clean.slice(first, last + 1);
    }

    analysis = JSON.parse(clean);
  } catch (e) {
    analysis = {
      summary: "Не вдалося розпарсити JSON аналізу.",
      tone: "невідомий",
      pain_points: [],
      ideas: [],
      rules: ["Відповідай доброзичливо та коротко."],
      _error: String(e?.message || e),
    };
  }

  return { chatId, date: todayUTC(), analysis };
}

async function listUserKeys(likesKV, cursor = undefined) {
  return await likesKV.list({ prefix: MEM_PREFIX, cursor }); // {keys, cursor, list_complete}
}

async function putInsight(env, key, val) {
  if (!env.STATE_KV) return;
  await kvPutJSON(env.STATE_KV, key, val, INSIGHT_TTL);
}

async function logChecklist(env, text) {
  try { await appendToChecklist(env, text); } catch {}
}

async function countChats(env) {
  if (!env.LIKES_KV) return 0;
  let cursor, cnt = 0;
  do {
    const page = await env.LIKES_KV.list({ prefix: MEM_PREFIX, cursor });
    for (const k of page.keys || []) if (k.name.endsWith(":mem")) cnt++;
    cursor = page.cursor;
    if (page.list_complete) break;
  } while (cursor);
  return cnt;
}

// ---------- one-key run ----------
async function runForKey(env, key) {
  if (!env.LIKES_KV) return { ok:false, error:"LIKES_KV missing" };
  const m = key.match(/^u:(.+?):mem$/);
  const chatId = m?.[1];
  if (!chatId) return { ok:false, error:"bad key" };

  const state = await kvGetJSON(env.LIKES_KV, key, null);
  if (!state) return { ok:false, error:"state not found", key };

  const insight = await analyzeOneUser(env, chatId, state);
  if (!insight) return { ok:false, error:"empty messages" };

  const dailyKey  = `insight:${insight.date}:${chatId}`;
  const latestKey = `insight:latest:${chatId}`;
  await putInsight(env, dailyKey,  insight);
  await putInsight(env, latestKey, insight);

  // лог короткого прев’ю інсайту
  const preview = previewFromInsight(insight);
  await logChecklist(env, `🧠 insight ${chatId} → ${preview || "оновлено"}`);

  await logChecklist(env, `🌙 nightly(one) ${chatId} → saved daily+latest`);
  return { ok:true, dailyKey, latestKey };
}

// ---------- nightly (many) ----------
export async function runNightlyImprove(env, limitPerRun = 50) {
  if (!env.LIKES_KV) return { ok: false, error: "LIKES_KV missing" };

  let cursor;
  let processed = 0;
  const added = [];

  scan: while (true) {
    const page = await listUserKeys(env.LIKES_KV, cursor);
    cursor = page.cursor;

    for (const k of page.keys || []) {
      if (!k.name.endsWith(":mem")) continue;

      const m = k.name.match(/^u:(.+?):mem$/);
      const chatId = m?.[1];
      if (!chatId) continue;

      const state = await kvGetJSON(env.LIKES_KV, k.name, null);
      const insight = await analyzeOneUser(env, chatId, state);
      if (insight) {
        const dailyKey  = `insight:${insight.date}:${chatId}`;
        const latestKey = `insight:latest:${chatId}`;
        await putInsight(env, dailyKey,  insight);
        await putInsight(env, latestKey, insight);
        added.push(latestKey);

        // лог короткого прев’ю інсайту
        const preview = previewFromInsight(insight);
        await logChecklist(env, `🧠 insight ${chatId} → ${preview || "оновлено"}`);
      }

      processed++;
      if (processed >= limitPerRun) break scan;
    }

    if (page.list_complete) break;
  }

  await logChecklist(
    env,
    `🌙 nightly @ ${new Date().toISOString()} — insights:${added.length}, scanned:${processed}`
  );

  return { ok: true, scanned: processed, insights: added.length };
}

// ---------- routing (includes /debug/*) ----------
function ensureSecret(env, url) {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("s") === env.WEBHOOK_SECRET;
}

/**
 * ЄДИНИЙ хендлер:
 * - /ai/improve (GET/POST)            — запуск; ?limit=N
 * - /ai/improve/run|auto (GET/POST)   — те саме
 * - /ai/improve/test-one?key=...      — аналіз 1 ключа u:<id>:mem
 * - /debug/time                       — поточний час
 * - /debug/bindings                   — показати наявні KV-біндінги
 * - /debug/checklist/ping?msg=...     — записати рядок у чекліст
 * - /debug/likes/scan                 — показати кількість ключів та приклади
 * - /debug/likes/get?key=...          — прочитати конкретний ключ
 * - /debug/likes/seed?chat=<id>       — створити тестову памʼять
 * - /debug/insight/get?chat=<id>      — прочитати insight:latest:<id> зі STATE_KV
 * - /debug/brain/state[?chat=<id>]    — огляд стану інсайтів у STATE_KV
 */
export async function handleAiImprove(req, env, url) {
  const path = (url.pathname || "").toLowerCase();

  const isImprove = path.startsWith("/ai/improve");
  const isDebug   = path.startsWith("/debug/");
  if (!isImprove && !isDebug) return null;

  if (!ensureSecret(env, url)) return json({ ok:false, error:"unauthorized" }, 401);

  // ----- DEBUG -----
  if (path === "/debug/time" && req.method === "GET") {
    const now = new Date();

    // обираємо часову зону: ?tz=... або з ENV, інакше UTC
    const tz = url.searchParams.get("tz") || env.TIMEZONE || "UTC";

    // людський локальний рядок у вибраній TZ
    const localHuman = new Intl.DateTimeFormat("uk-UA", {
      timeZone: tz,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(now);

    // оцінюємо офсет від UTC у хвилинах (приблизно, але стабільно)
    const utcMs = now.getTime();
    const tzMs = new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
    const offsetMin = Math.round((tzMs - utcMs) / 60000);

    return json({
      ok: true,
      utc_iso: now.toISOString(),
      tz,
      local_human: localHuman,
      offset_min: offsetMin, // для Europe/Kyiv ≈ 180 у літній період
    });
  }

  if (path === "/debug/bindings" && req.method === "GET") {
    const bind = (x) => !!x;
    return json({
      ok: true,
      has: {
        CHECKLIST_KV: bind(env.CHECKLIST_KV),
        DEDUP_KV: bind(env.DEDUP_KV),
        LIKES_KV: bind(env.LIKES_KV),
        OAUTH_KV: bind(env.OAUTH_KV),
        STATE_KV: bind(env.STATE_KV),
        TODO_KV: bind(env.TODO_KV),
        USER_OAUTH_KV: bind(env.USER_OAUTH_KV),
      }
    });
  }

  if (path === "/debug/checklist/ping" && (req.method === "GET" || req.method === "POST")) {
    const msg = url.searchParams.get("msg") || "ping";
    await logChecklist(env, `🧪 checklist ping: ${msg} @ ${new Date().toISOString()}`);
    return json({ ok:true, written:true, msg });
  }

  if (path === "/debug/likes/scan" && req.method === "GET") {
    if (!env.LIKES_KV) return json({ ok:false, error:"LIKES_KV missing" }, 500);
    const all = [];
    let cursor;
    do {
      const page = await env.LIKES_KV.list({ prefix: MEM_PREFIX, cursor });
      for (const k of page.keys || []) if (k.name.endsWith(":mem")) all.push(k.name);
      cursor = page.cursor;
      if (page.list_complete) break;
    } while (cursor);
    return json({ ok:true, totalChats: all.length, samples: all.slice(0, 20) });
  }

  if (path === "/debug/likes/get" && req.method === "GET") {
    if (!env.LIKES_KV) return json({ ok:false, error:"LIKES_KV missing" }, 500);
    const key = url.searchParams.get("key");
    if (!key) return json({ ok:false, error:"pass ?key=u:<chatId>:mem" }, 400);
    const raw = await env.LIKES_KV.get(key);
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    return json({ ok:true, key, exists: !!raw, raw, parsed });
  }

  if (path === "/debug/likes/seed" && (req.method === "GET" || req.method === "POST")) {
    if (!env.LIKES_KV) return json({ ok:false, error:"LIKES_KV missing" }, 500);
    const chat = url.searchParams.get("chat") || "test";
    const key = `u:${chat}:mem`;
    const demo = {
      messages: [
        { role: "user",      text: "Привіт! Мені подобається, але відповіді інколи довгі." },
        { role: "assistant", text: "Окей! Я можу бути стислим і конкретним." },
        { role: "user",      text: "Спробуй підсумувати мої останні питання коротко." }
      ],
      updatedAt: new Date().toISOString()
    };
    await env.LIKES_KV.put(key, JSON.stringify(demo));
    return json({ ok:true, seeded: key });
  }

  if (path === "/debug/insight/get" && req.method === "GET") {
    if (!env.STATE_KV) return json({ ok:false, error:"STATE_KV missing" }, 500);
    const chat = url.searchParams.get("chat");
    if (!chat) return json({ ok:false, error:"pass ?chat=<chatId>" }, 400);
    const key = `insight:latest:${chat}`;
    const raw = await env.STATE_KV.get(key);
    let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    return json({ ok:true, key, exists: !!raw, raw, parsed });
  }

  // NEW: огляд стану інсайтів у STATE_KV
  if (path === "/debug/brain/state" && req.method === "GET") {
    if (!env.STATE_KV) return json({ ok:false, error:"STATE_KV missing" }, 500);

    const chat = url.searchParams.get("chat");
    if (chat) {
      const key = `insight:latest:${chat}`;
      const raw = await env.STATE_KV.get(key);
      let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch {}
      return json({ ok:true, mode:"single", key, exists: !!raw, raw, parsed });
    }

    const keys = [];
    let cursor;
    do {
      const page = await env.STATE_KV.list({ prefix: "insight:", cursor });
      for (const k of page.keys || []) keys.push(k.name);
      cursor = page.cursor;
      if (page.list_complete) break;
    } while (cursor);

    return json({ ok:true, mode:"list", total: keys.length, samples: keys.slice(0, 30) });
  }

  // ----- IMPROVE -----
  if (path === "/ai/improve/test-one" && req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ ok:false, error:"pass ?key=u:<chatId>:mem" }, 400);
    const res = await runForKey(env, key);
    return json(res, res.ok ? 200 : 500);
  }

  if (path === "/ai/improve" && req.method === "GET") {
    const chats = await countChats(env);
    return json({ ok: true, hint: "POST here to trigger night agent", chats });
  }

  if (path === "/ai/improve" && req.method === "POST") {
    const limit = Number(url.searchParams.get("limit") || "80") || 80;
    const total = await countChats(env);
    await logChecklist(env, `🌙 night-agent: start (chats:${total}, limit:${limit})`);
    try {
      const res = await runNightlyImprove(env, limit);
      await logChecklist(env, `🌙 night-agent: done ok=${res.ok} insights=${res.insights} scanned=${res.scanned}`);
      return json({ ok: true, ...res });
    } catch (e) {
      await logChecklist(env, `🌙 night-agent: fail ${String(e?.message || e)}`);
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  }

  if ((path === "/ai/improve/run" || path === "/ai/improve/auto") &&
      (req.method === "GET" || req.method === "POST")) {
    const limit = Number(url.searchParams.get("limit") || "80") || 80;
    const res = await runNightlyImprove(env, limit);
    return json(res, res.ok ? 200 : 500);
  }

  return json({ ok:false, error:"not found", path }, 404);
}