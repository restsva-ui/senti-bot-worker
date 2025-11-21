// Нічні авто-поліпшення: витягуємо факти, коротке резюме діалогу,
// формуємо пропозиції поліпшень і записуємо у пам'ять.
//
// Пам'ять:
//
/*
  Ми підтримуємо обидва варіанти сховищ, щоб уникнути розсинхрону:
  - LIKES_KV  -> ключі типу  u:<chatId>:mem
  - STATE_KV  -> ключі типу  dlg:<chatId>:turns  або  u:<chatId>:mem
*/
//
// Додатково:
//  - CHECKLIST_KV — зберігаємо денні підсумки й лог останнього прогону
//  - MODEL_ORDER  — через modelRouter.askAnyModel (з фолбеком на think())

import { askAnyModel } from "./modelRouter.js";
import { think as coreThink } from "./brain.js";

// Пам’ять діалогів (короткий контекст та оновлення фактів)
import {
  getShortContext,
  rememberFacts,
  contextToTranscript,
} from "./memory.js"; // ⚠️ лишаємо як є, але нижче добираємо chatId ще й зі STATE_KV

// ────────────────────────────────────────────────────────────────────────────

const J = (x) => JSON.stringify(x, null, 2);

// Безпечний JSON.parse
function safeJSON(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// CHECKLIST put (опційно)
async function putChecklist(env, key, value) {
  if (!env.CHECKLIST_KV) return;
  try {
    await env.CHECKLIST_KV.put(
      key,
      typeof value === "string" ? value : JSON.stringify(value, null, 2)
    );
  } catch {}
}

// Витяг chatId зі сховища за різними схемами назв ключів
function pickChatIdFromKey(name = "") {
  // u:<id>:mem
  let m = String(name).match(/^u:([^:]+):mem$/);
  if (m?.[1]) return m[1];

  // dlg:<id>:turns
  m = String(name).match(/^dlg:([^:]+):/);
  if (m?.[1]) return m[1];

  // state:<id>:mem (на випадок ін. префіксів)
  m = String(name).match(/^[a-z]+:([^:]+):mem$/);
  if (m?.[1]) return m[1];

  return null;
}

// Отримати список активних чатів із LIKES_KV і/або STATE_KV
async function listActiveChats(env) {
  const sets = new Set();

  // LIKES_KV
  if (env?.LIKES_KV?.list) {
    try {
      let cursor;
      do {
        const r = await env.LIKES_KV.list({ prefix: "u:", cursor, limit: 1000 });
        for (const k of r.keys || []) {
          const id = pickChatIdFromKey(k.name);
          if (id) sets.add(id);
        }
        cursor = r.cursor;
      } while (cursor);
    } catch {}
  }

  // STATE_KV
  if (env?.STATE_KV?.list) {
    try {
      // пробуємо два основні префікси
      const prefixes = ["dlg:", "u:"];
      for (const pref of prefixes) {
        let cursor;
        do {
          const r = await env.STATE_KV.list({ prefix: pref, cursor, limit: 1000 });
          for (const k of r.keys || []) {
            const id = pickChatIdFromKey(k.name);
            if (id) sets.add(id);
          }
          cursor = r.cursor;
        } while (cursor);
      }
    } catch {}
  }

  return Array.from(sets);
}

// Системний промпт для екстракції фактів/резюме
function buildSystemPrompt(dateISO) {
  return (
`Ти — помічник-редактор Senti. Із короткої стенограми витягни сталі факти про користувача
та стислий підсумок дня.

СТРОГО поверни лише JSON без зайвого тексту:

{
  "facts": ["факт 1", "факт 2"],
  "daily_summary": "2–4 речення підсумку розмови/дня",
  "suggestions": ["як зробити відповіді Senti кориснішими", "приклад"]
}

Дата зараз: ${dateISO}.
Будь обережний: не вигадуй того, чого немає у стенограмі.`
  );
}

// Витяг для одного чату
async function improveOneChat(env, chatId) {
  // беремо останні 14 реплік (user/assistant)
  const ctx = await getShortContext(env, chatId, 14).catch(() => null);
  if (!ctx || ctx.length === 0) {
    return { chatId, skipped: true, reason: "no_context" };
  }

  const transcript = contextToTranscript(ctx);
  const system = buildSystemPrompt(new Date().toISOString());
  const prompt =
`Ось стенограма нещодавнього спілкування між користувачем і Senti:
---
${transcript}
---
На її основі побудуй JSON строго за інструкцією вище. Поверни лише JSON.`.trim();

  // Виклик моделі: через MODEL_ORDER, фолбек — coreThink
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  let raw = "";
  try {
    if (modelOrder) {
      raw = await askAnyModel(env, modelOrder, prompt, {
        systemHint: system,
        temperature: 0.2,
        max_tokens: 800
      });
    } else {
      raw = await coreThink(env, prompt, system);
    }
  } catch (e) {
    return { chatId, error: `llm:${String(e?.message || e)}` };
  }

  // Робастне очищення перед JSON.parse
  let clean = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/^[\s\S]*?\{/, "{")      // відкинути преамбулу до першої "{"
    .replace(/\}[\s\S]*$/, "}")       // усе після останньої "}" відкинути
    .replace(/\n+\[via[\s\S]*$/i, "") // прибрати "via ..." підписи
    .trim();

  const parsed = safeJSON(clean);
  if (!parsed || typeof parsed !== "object") {
    return { chatId, error: "model-json-parse" };
  }

  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const summary = String(parsed.daily_summary || "").trim();
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  // Оновлюємо довготривалі факти (дедуп — усередині rememberFacts)
  if (facts.length) {
    try { await rememberFacts(env, chatId, facts); } catch {}
  }

  // Пишемо денне резюме (опційно у CHECKLIST_KV)
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await putChecklist(env, `auto:${chatId}:${dateKey}`, {
    chatId, date: dateKey, summary, facts, suggestions,
  });

  return {
    chatId,
    factsAdded: facts.length,
    hasSummary: Boolean(summary),
    suggestions: suggestions.length
  };
}

// Публічна функція (CRON/ручний запуск)
export async function nightlyAutoImprove(env, { now = new Date(), reason = "" } = {}) {
  if (String(env.AUTO_IMPROVE || "on").toLowerCase() === "off") {
    return { disabled: true };
  }

  const chats = await listActiveChats(env);
  const results = [];
  for (const chatId of chats) {
    try {
      const r = await improveOneChat(env, chatId);
      results.push(r);
      // невелика пауза, щоб не створювати спайки
      await new Promise(res => setTimeout(res, 40));
    } catch (e) {
      results.push({ chatId, error: String(e?.message || e) });
    }
  }

  await putChecklist(env, `auto:last-run`, {
    at: now.toISOString(),
    reason,
    totalChats: chats.length,
    results,
  });

  return { totalChats: chats.length };
}