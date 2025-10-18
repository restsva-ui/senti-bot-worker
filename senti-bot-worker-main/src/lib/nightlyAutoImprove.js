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

// --------- JSON helpers (стабілізація) --------------------------------------
function stripCodeFences(s = "") {
  return String(s)
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
function normalizeQuotes(s = "") {
  // заміна «розумних» лапок на прямі
  return s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ");
}
function cutBalancedJson(s = "") {
  // Вирізаємо рівно ту частину, що є об’єктом {...} з балансуванням фігурних дужок,
  // враховуючи лапки та екранування (\"), щоб не переплутати вкладені { }.
  const text = String(s);
  const start = text.indexOf("{");
  if (start === -1) return null;

  let i = start;
  let depth = 0;
  let inStr = false;
  let strCh = '"';

  while (i < text.length) {
    const ch = text[i];

    if (inStr) {
      if (ch === "\\" && i + 1 < text.length) {
        i += 2; // пропускаємо екранований символ
        continue;
      }
      if (ch === strCh) inStr = false;
    } else {
      if (ch === '"' || ch === "'") {
        inStr = true;
        strCh = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    i++;
  }
  return null; // не знайшли збалансоване закриття
}

function removeTrailingCommas(s = "") {
  // Видаляємо висячі коми перед } або ]
  return s.replace(/,\s*([}\]])/g, "$1");
}

// головний “реаніматор” рядків: замінює сирі переноси усередині лапок на \n
function escapeNewlinesInsideStrings(s = "") {
  let out = "";
  let inStr = false;
  let strCh = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\" && i + 1 < s.length) {
        out += ch + s[i + 1];
        i++;
        continue;
      }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\n"; continue; }
      if (ch === strCh) { inStr = false; }
      out += ch;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; }
      out += ch;
    }
  }
  return out;
}

function tryParseJSONPossiblyBroken(outText) {
  // 1) прибираємо кодові блоки, лапки, службові теги і т.п.
  let clean = stripCodeFences(outText);
  clean = clean.replace(/\n+\[via[^\]]*\]\s*$/i, "");
  clean = normalizeQuotes(clean);

  // 2) вирізаємо збалансований JSON-об'єкт
  let jsonChunk = cutBalancedJson(clean);
  if (!jsonChunk) jsonChunk = clean.trim();

  // 3) спроби парсингу
  const attempts = [
    (x) => x,
    removeTrailingCommas,
    escapeNewlinesInsideStrings,
    (x) => escapeNewlinesInsideStrings(removeTrailingCommas(x)),
  ];

  for (const fix of attempts) {
    try {
      const prepared = fix(jsonChunk);
      return { ok: true, value: JSON.parse(prepared) };
    } catch {}
  }
  return { ok: false, _raw: outText, _clean: jsonChunk, error: "json-parse-failed" };
}

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
  "facts": ["факт 1", "факт 2"],
  "daily_summary": "2–4 речення підсумку",
  "suggestions": ["ідея покращення Senti"]
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
  const parsed = tryParseJSONPossiblyBroken(String(raw));
  if (!parsed.ok) {
    return { chatId, error: "model-json-parse", _error: parsed.error };
  }

  const data = parsed.value || {};
  const facts = Array.isArray(data.facts) ? data.facts : [];
  const summary = String(data.daily_summary || "").trim();
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

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