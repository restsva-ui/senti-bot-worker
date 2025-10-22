// src/lib/selfTune.js
// Self-Tune (мультимовний, з довготривалим збереженням стилю).
// Профілі користувача зберігаються окремо для кожної мови у вигляді:
//   insight:latest:<chatId>:<lang>
//
// Якщо профіль існує — Senti застосовує його до system prompt.
// Якщо ні — аналізує останні 16 повідомлень користувача, створює профіль і кешує.
//
// Автор: Senti core (оновлення 2025-10)

function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}

const DLG_KEY = (uid) => `dlg:${uid}:log`;

// --------------------------------------------------------------
// Допоміжні функції
// --------------------------------------------------------------

async function kvGetJson(kv, key) {
  try {
    const v = await kv.get(key, "json");
    if (v && typeof v === "object") return v;
  } catch {}
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function guessLangSimple(text = "") {
  const s = String(text || "").toLowerCase();
  if (/[їієґ]/i.test(s)) return "uk";
  if (/[ёыэ]/i.test(s)) return "ru";
  if (/[a-z]/i.test(s) && !/[а-яёіїєґ]/i.test(s)) return "en";
  if (/[а-яёіїєґ]/i.test(s)) return "uk";
  if (/[äöüß]/i.test(s)) return "de";
  if (/[çéàèùâêîôûëïüœ]/i.test(s)) return "fr";
  return "uk";
}

function hasEmoji(s = "") {
  try { return /[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(s); }
  catch { return false; }
}

function isInformalUAorRU(s = "") {
  const t = s.toLowerCase();
  const hints = ["прив", "дякс", "пасіб", "шо", "чо", "ти", "йо", "ага", "ок", "окей", "спс", "пж", "дякую", "сорян", "лол", "ахах", "круто", "жесть"];
  return hints.some(h => t.includes(h));
}

function isPoliteUAorRU(s = "") {
  const t = s.toLowerCase();
  const hints = ["будь ласка", "будь-ласка", "підкажіть", "скажіть", "дякую."];
  return hints.some(h => t.includes(h));
}

// --------------------------------------------------------------
// Аналіз діалогів користувача
// --------------------------------------------------------------

function analyzeTurns(turns = []) {
  const userTurns = turns.filter(t => (t?.role || "user") === "user" && t?.text);
  if (!userTurns.length) {
    return { tone: "дружній, нейтральний", rules: ["Пиши простою людською мовою.", "Відповідай коротко (1–3 речення)."] };
  }

  const N = userTurns.length;
  let totalLen = 0, qCount = 0, emojiCount = 0, informalCount = 0, politeCount = 0;
  const langStats = { uk: 0, ru: 0, en: 0, de: 0, fr: 0 };

  for (const u of userTurns) {
    const s = String(u.text || "");
    totalLen += s.length;
    if (s.trim().endsWith("?")) qCount++;
    if (hasEmoji(s)) emojiCount++;
    if (isInformalUAorRU(s)) informalCount++;
    if (isPoliteUAorRU(s)) politeCount++;
    const L = guessLangSimple(s);
    langStats[L] = (langStats[L] || 0) + 1;
  }

  const avgLen = totalLen / N;
  const qRatio = qCount / N;
  const emojiRatio = emojiCount / N;
  const topLang = Object.entries(langStats).sort((a, b) => b[1] - a[1])[0]?.[0] || "uk";

  let tone = "нейтральний і дружній";
  if (informalCount / N > 0.15) tone = "неформальний, розслаблений";
  else if (politeCount / N > 0.15) tone = "ввічливий, спокійний";

  const rules = [];
  const langMap = { uk: "українською", ru: "російською", en: "англійською", de: "німецькою", fr: "французькою" };

  rules.push(`Пиши ${langMap[topLang] || "українською"} мовою.`);
  rules.push(informalCount > politeCount ? "Звертайся на «ти»." : "Використовуй м’який нейтральний стиль («ви»).");

  if (avgLen < 45) rules.push("Користувач лаконічний — відповідай коротко (1–3 речення).");
  else if (avgLen > 120) rules.push("Користувач любить деталі — можна давати розгорнуті відповіді.");
  else rules.push("Пиши по суті, але не сухо.");

  if (qRatio > 0.35) rules.push("Часто ставить питання — відповідай чітко й по пунктах.");
  if (emojiRatio >= 0.25) rules.push("Використовуй 1 доречне емодзі на початку.");
  else rules.push("Емодзі додавай лише коли природно.");

  rules.push("Уникай фраз типу «як ШІ»; спілкуйся як справжній друг-помічник.");
  return { tone, rules, lang: topLang };
}

function toTextBlock(a) {
  if (!a) return null;
  const lines = [`• Тон: ${a.tone}.`, "• Підлаштування:"];
  for (const r of (a.rules || []).slice(0, 10)) lines.push(`  – ${r}`);
  return lines.join("\n");
}

// --------------------------------------------------------------
// Головні функції
// --------------------------------------------------------------

export async function loadSelfTune(env, chatId) {
  try {
    const kv = ensureState(env);

    // Пробуємо знайти останні репліки
    const logArr = await kvGetJson(kv, DLG_KEY(chatId));
    const recent = Array.isArray(logArr) ? logArr.slice(-16) : [];

    // Якщо є останній текст — визначаємо мову
    const lastMsg = recent?.length ? recent[recent.length - 1]?.text || "" : "";
    const lang = guessLangSimple(lastMsg);

    // Перевіряємо, чи є профіль для цієї мови
    const key = `insight:latest:${chatId}:${lang}`;
    const stored = await kvGetJson(kv, key);
    if (stored?.analysis && (stored.analysis.rules?.length || stored.analysis.tone)) {
      return toTextBlock(stored.analysis);
    }

    // Якщо ні — генеруємо
    if (recent.length) {
      const analysis = analyzeTurns(recent);
      const payload = JSON.stringify({ analysis, ts: Date.now() });
      await kv.put(key, payload); // зберігаємо без TTL
      return toTextBlock(analysis);
    }

    return null;
  } catch (e) {
    return null;
  }
}

export async function saveSelfTune(env, chatId, analysis) {
  const kv = ensureState(env);
  try {
    const lang = analysis?.lang || "uk";
    const key = `insight:latest:${chatId}:${lang}`;
    const payload = JSON.stringify({ analysis, ts: Date.now() });
    await kv.put(key, payload);
    return true;
  } catch {
    return false;
  }
}