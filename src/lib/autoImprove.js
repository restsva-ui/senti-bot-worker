// Нічні авто-поліпшення: витягуємо факти, коротке резюме діалогу,
// формуємо пропозиції поліпшень і записуємо у пам'ять.
//
// Використовує:
//  - LIKES_KV  — короткий контекст і довготривалі факти (див. memory.js)
//  - CHECKLIST_KV (необов'язково) — збереження щоденного резюме для перегляду
//  - askAnyModel — будь-яка доступна LLM (з вашим fallback)
//

import { askAnyModel } from "./modelRouter.js";
import {
  getShortContext,
  recallFacts,
  rememberFacts,
  contextToTranscript,
} from "./memory.js";

// Безпечний JSON.parse
function safeJSON(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// Зберегти у CHECKLIST_KV (опційно)
async function putChecklist(env, key, value) {
  if (!env.CHECKLIST_KV) return;
  try {
    await env.CHECKLIST_KV.put(key, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  } catch {}
}

// Отримати список активних чатів із LIKES_KV (префікс u:...:mem)
async function listActiveChats(env) {
  if (!env.LIKES_KV?.list) return [];
  const out = [];
  let cursor;
  do {
    const resp = await env.LIKES_KV.list({ prefix: "u:", cursor });
    for (const k of resp.keys || []) {
      const m = k.name.match(/^u:(.+):mem$/);
      if (m) out.push(m[1]);
    }
    cursor = resp.cursor;
  } while (cursor);
  // унікуємо
  return [...new Set(out)];
}

// Побудова системного підказника для екстракції фактів/резюме
function buildSystemPrompt(dateISO) {
  return (
`Ти — помічник-редактор Senti. Твоє завдання — з короткої стенограми діалогу
витягнути корисні сталі факти про користувача та стисле резюме дня.

Формат відповіді СТРОГО у JSON (без додаткового тексту):

{
  "facts": ["факт 1", "факт 2", ...],           // лаконічні, довготривалі
  "daily_summary": "2–4 речення підсумку",      // зрозуміло і без зайвого
  "suggestions": ["ідея покращення Senti", "..."] // поради щодо тону/шаблонів
}

Дата сьогодні: ${dateISO}.
Надійність понад креативність. Не вигадуй, якщо у стенограмі немає даних.`
  );
}

// Головний процес для одного чату
async function improveOneChat(env, chatId) {
  const ctx = await getShortContext(env, chatId, 14);
  if (!ctx || ctx.length === 0) return { chatId, skipped: true };

  const transcript = contextToTranscript(ctx);
  const sys = buildSystemPrompt(new Date().toISOString());

  const prompt =
`Ось стенограма нещодавнього спілкування між користувачем і Senti:
---
${transcript}
---

На основі цього сформуй JSON згідно інструкції. Пам'ятай: тільки JSON.`;

  // просимо модель (із вашим fallback)
  const raw = await askAnyModel(env, prompt, { system: sys, temperature: 0.2, max_tokens: 800 });
  // якщо відповідь містить діаг-тег "[via ...]" — акуратно відріжемо
  const pure = String(raw).replace(/\n?\[via [^\]]+\]\s*$/i, "");
  const parsed = safeJSON(pure);
  if (!parsed || typeof parsed !== "object") {
    return { chatId, error: "model-json-parse" };
  }

  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const summary = String(parsed.daily_summary || "").trim();
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  // оновлюємо довготривалі факти (дедуп)
  if (facts.length) await rememberFacts(env, chatId, facts);

  // пишемо денне резюме (опційно у CHECKLIST_KV)
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await putChecklist(env, `auto:${chatId}:${dateKey}`, {
    chatId,
    date: dateKey,
    summary,
    facts,
    suggestions,
  });

  return { chatId, factsAdded: facts.length, hasSummary: !!summary, suggestions: suggestions.length };
}

// Публічна функція для виклику за CRON
export async function nightlyAutoImprove(env, { now = new Date(), reason = "" } = {}) {
  // захист: можна вимкнути через ENV
  if (String(env.AUTO_IMPROVE || "on").toLowerCase() === "off") return { disabled: true };

  const chats = await listActiveChats(env);
  const results = [];
  for (const chatId of chats) {
    try {
      const r = await improveOneChat(env, chatId);
      results.push(r);
      // легкий тротлінг, щоб не спайкати
      await new Promise(res => setTimeout(res, 50));
    } catch (e) {
      results.push({ chatId, error: String(e?.message || e) });
    }
  }
  // збережемо компактний лог останнього прогону
  await putChecklist(env, `auto:last-run`, {
    at: now.toISOString(),
    reason,
    totalChats: chats.length,
    results,
  });
  return { totalChats: chats.length };
}