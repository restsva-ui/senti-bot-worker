// src/routes/aiImprove.js
// Нічний агент: читає коротку пам'ять LIKES_KV, робить стислий аналіз,
// зберігає інсайти у STATE_KV і (опційно) пише нотатку у CHECKLIST_KV.

import { askAnyModel } from "../lib/modelRouter.js";
import { appendChecklist as appendToChecklist } from "../lib/kvChecklist.js";

const INSIGHT_TTL = 60 * 60 * 24 * 14; // 14 днів
const MEM_PREFIX  = "u:";              // з memory.js: keyFor(chatId) -> u:<chatId>:mem

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

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

async function analyzeOneUser(env, chatId, state) {
  const messages = (state?.messages || []).slice(-20);
  if (messages.length === 0) return null;

  // Стиснемо контекст у плоский текст (роль: текст)
  const compact = messages
    .map((m) => `${m.role === "user" ? "U" : "B"}: ${m.text}`)
    .join("\n")
    .slice(0, 8000); // захист від надто великих запитів

  const prompt =
    "Ось останній контекст діалогу (U — user, B — bot):\n\n" + compact;

  let analysis;
  try {
    const out = await askAnyModel(env, `${buildSystemHint()}\n\n${prompt}`, {
      temperature: 0.2,
      max_tokens: 600,
    });
    // відповідь може містити діаг-тег у кінці — виріжемо блок у \n\n[via ...]
    const clean = out.replace(/\n+\[via[\s\S]*$/i, "").trim();
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

  return {
    chatId,
    date: todayUTC(),
    analysis,
  };
}

async function listUserKeys(likesKV, cursor = undefined) {
  // Cloudflare KV: list({ prefix, cursor })
  const res = await likesKV.list({ prefix: MEM_PREFIX, cursor });
  return res; // {keys:[{name},..], cursor, list_complete}
}

async function putInsight(env, key, val) {
  if (!env.STATE_KV) return;
  await kvPutJSON(env.STATE_KV, key, val, INSIGHT_TTL);
}

// пишемо у видимий "service:checklist" через загальну утиліту
async function logChecklist(env, text) {
  try { await appendToChecklist(env, text); } catch {}
}

// підрахунок доступних чатів (ключі u:<chatId>:mem)
async function countChats(env) {
  if (!env.LIKES_KV) return 0;
  let cursor, cnt = 0;
  do {
    const page = await env.LIKES_KV.list({ prefix: MEM_PREFIX, cursor });
    for (const k of page.keys || []) {
      if (k.name.endsWith(":mem")) cnt++;
    }
    cursor = page.cursor;
    if (page.list_complete) break;
  } while (cursor);
  return cnt;
}

/**
 * Запуск нічного аналізу: проходиться по LIKES_KV, робить інсайти на кожного користувача.
 * Повертає короткий підсумок.
 */
export async function runNightlyImprove(env, limitPerRun = 50) {
  if (!env.LIKES_KV) return { ok: false, error: "LIKES_KV missing" };

  let cursor;
  let processed = 0;
  const added = [];

  scan: while (true) {
    const page = await listUserKeys(env.LIKES_KV, cursor);
    cursor = page.cursor;
    for (const k of page.keys || []) {
      // беремо лише ключі пам'яті з постфиксом ":mem"
      if (!k.name.endsWith(":mem")) continue;

      // chatId між 'u:' та ':mem'
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
      }

      processed++;
      if (processed >= limitPerRun) break scan;
    }
    if (page.list_complete) break;
  }

  // глобальна зведена нота (видима у чеклисті)
  await logChecklist(
    env,
    `🌙 nightly @ ${new Date().toISOString()} — insights:${added.length}, scanned:${processed}`
  );

  return { ok: true, scanned: processed, insights: added.length };
}

// простий guard секрету
function ensureSecret(env, url) {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("s") === env.WEBHOOK_SECRET;
}

/** HTTP-роути: /ai/improve (POST), /ai/improve/auto, /ai/improve/run */
export async function handleAiImprove(req, env, url) {
  const path = (url.pathname || "").toLowerCase();

  if (!path.startsWith("/ai/improve")) return null;
  if (!ensureSecret(env, url)) return json({ ok: false, error: "unauthorized" }, 401);

  // Підказка для GET /ai/improve
  if (path === "/ai/improve" && req.method === "GET") {
    const chats = await countChats(env);
    return json({ ok: true, hint: "POST here to trigger night agent", chats });
  }

  // Кнопка з чеклиста надсилає POST /ai/improve
  if (path === "/ai/improve" && req.method === "POST") {
    const total = await countChats(env);
    await logChecklist(env, `🌙 night-agent: start (chats:${total})`);
    try {
      const res = await runNightlyImprove(env, 80);
      await logChecklist(env, `🌙 night-agent: done ok=${res.ok} insights=${res.insights} scanned=${res.scanned}`);
      return json({ ok: true, ...res });
    } catch (e) {
      await logChecklist(env, `🌙 night-agent: fail ${String(e?.message || e)}`);
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  }

  // Сумісні маршрути
  if ((path === "/ai/improve/run" || path === "/ai/improve/auto") && (req.method === "GET" || req.method === "POST")) {
    const res = await runNightlyImprove(env, 80);
    return json(res, res.ok ? 200 : 500);
  }

  return json({ ok: false, error: "not found" }, 404);
}