// src/lib/selfTune.js
// Адаптивний self-tune для Senti.
// 1) Якщо у KV є заздалегідь збережені інсайти (insight:latest:<chatId>) — повертаємо їх.
// 2) Інакше на льоту аналізуємо останні репліки з діалог-логу (dlg:<chatId>:log) і
//    генеруємо дружні правила, щоб бути «на одній хвилі» з користувачем.
//
// Формат збережених інсайтів:
//   key:   insight:latest:<chatId>
//   value: { analysis: { tone: string, rules: string[] }, ts: <ms> }
//
// Утиліти:
//   - loadSelfTune(env, chatId) -> string|null (готовий блок для system prompt)
//   - saveSelfTune(env, chatId, analysisObj)  (примусово зберегти оцінку)

function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}

// ————— Внутрішні допоміжні ———————————————————————————————————————————————

const DLG_KEY = (uid) => `dlg:${uid}:log`;

// Пробуємо прочитати JSON з KV із запасним парсером.
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

// «Груба» детекція мови (без імпортів, щоб не тягнути залежності)
function guessLangSimple(text = "") {
  const s = String(text || "").toLowerCase();

  // швидкі маркери
  if (/[їієґ]/i.test(s)) return "uk";
  if (/[ёыэ]/i.test(s)) return "ru";

  // словники-підказки
  const hasAny = (arr) => arr.some(w => s.includes(w));
  if (hasAny(["the ", " and ", " is ", "what ", "how "])) return "en";
  if (hasAny([" ist ", " und ", "wie ", "hauptstadt", "heute"])) return "de";
  if (hasAny([" est ", " et ", "que ", "qu'", "ville"])) return "fr";

  // латинка → частіше en
  if (/[a-z]/i.test(s) && !/[а-яёіїєґ]/i.test(s)) return "en";
  // кирилиця → без специфічних укр/рос маркерів — припустимо «uk»
  if (/[а-яёіїєґ]/i.test(s)) return "uk";
  return "uk";
}

function hasEmoji(s = "") {
  try {
    return /[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(s);
  } catch {
    return false;
  }
}

function isInformalUAorRU(s = "") {
  const t = s.toLowerCase();
  const hints = [
    "прив", "дякс", "пасіб", "шо", "чо", "ти", "йо", "ага", "ок", "окей",
    "спс", "пж", "дякую", "сорян", "лол", "ахах", "круто", "жесть",
    "ага,", "угу", "таки", "шо там", "шо робиш"
  ];
  return hints.some(h => t.includes(h));
}

function isPoliteUAorRU(s = "") {
  const t = s.toLowerCase();
  const hints = ["будь ласка", "будь-ласка", "будь ласка,", "будь-ласка,", "підкажіть", "скажіть", "будь ласка.", "дякую."];
  return hints.some(h => t.includes(h));
}

function analyzeTurns(turns = []) {
  // Беремо тільки повідомлення користувача
  const userTurns = turns.filter(t => (t?.role || "user") === "user" && t?.text);
  if (!userTurns.length) {
    return {
      tone: "дружній, нейтральний",
      rules: [
        "Пиши простою людською мовою.",
        "Відповіді 1–3 речення; розширюй, лише якщо попросять."
      ]
    };
  }

  const N = userTurns.length;
  let totalLen = 0;
  let qCount = 0;
  let emojiCount = 0;
  let informalCount = 0;
  let politeCount = 0;

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

  // Домінантна мова користувача
  const topLang = Object.entries(langStats).sort((a, b) => b[1] - a[1])[0]?.[0] || "uk";

  // Оцінка тону
  const informal = informalCount / N > 0.15;
  const polite = politeCount / N > 0.15;

  let tone = "людяний і теплий";
  if (informal && !polite) tone = "неформальний, дружній";
  else if (polite && !informal) tone = "ввічливий, спокійний";
  else tone = "дружній, нейтральний";

  const rules = [];

  // Мова
  const langMapName = { uk: "українською", ru: "російською", en: "англійською", de: "німецькою", fr: "французькою" };
  rules.push(`Пиши ${langMapName[topLang]}; не перемикайся без явного прохання.`);

  // Звертання
  if (informal) rules.push("Звертайся на «ти», без канцеляризмів.");
  else rules.push("Тримай нейтральну ввічливість; «ти» ↔ «ви» підлаштовуй під тон користувача.");

  // Довжина
  if (avgLen < 45) rules.push("Користувач лаконічний — відповідай коротко (1–3 речення).");
  else if (avgLen > 120) rules.push("Користувач любить деталі — можна давати розгорнуті відповіді (по пунктах).");
  else rules.push("Відповідай по суті; розширюй, якщо попросять.");

  // Питальні форми
  if (qRatio > 0.35) rules.push("Часто ставить питання — давай чіткі, структуровані відповіді.");

  // Емодзі
  if (emojiRatio >= 0.25) rules.push("Доречно додавати 1 емодзі на початку відповіді.");
  else rules.push("Емодзі використовуй помірно або взагалі без них, якщо не пасує.");

  // «Дружність»
  rules.push("Уникай фраз типу «як штучний інтелект…»; говори як друг-помічник.");

  return { tone, rules };
}

function toTextBlock(analysis) {
  if (!analysis) return null;
  const { tone, rules } = analysis;
  const lines = [];
  if (tone) lines.push(`• Бажаний тон: ${tone}.`);
  if (Array.isArray(rules) && rules.length) {
    lines.push("• Підлаштування під користувача:");
    for (const r of rules.slice(0, 10)) lines.push(`  – ${r}`);
  }
  return lines.join("\n");
}

// ————— Публічний API ————————————————————————————————————————————————

/** Завантажити або згенерувати self-tune текст для system prompt */
export async function loadSelfTune(env, chatId) {
  try {
    const kv = ensureState(env);

    // 1) Якщо є заздалегідь збережені інсайти — поважаємо їх
    const stored = await kvGetJson(kv, `insight:latest:${chatId}`);
    if (stored?.analysis && (stored.analysis.tone || (stored.analysis.rules || []).length)) {
      return toTextBlock(stored.analysis);
    }

    // 2) Інакше робимо легкий онлайновий аналіз останніх реплік
    const logArr = await kvGetJson(kv, DLG_KEY(chatId));
    if (!Array.isArray(logArr) || !logArr.length) return null;

    const recent = logArr.slice(-16); // достатньо для швидкого й стабільного профілю
    const analysis = analyzeTurns(recent);
    return toTextBlock(analysis);
  } catch {
    return null;
  }
}

/** Примусово зберегти аналіз (наприклад, якщо зробив офлайн-обробку) */
export async function saveSelfTune(env, chatId, analysis) {
  const kv = ensureState(env);
  try {
    const payload = JSON.stringify({ analysis, ts: Date.now() });
    await kv.put(`insight:latest:${chatId}`, payload);
    return true;
  } catch {
    return false;
  }
}