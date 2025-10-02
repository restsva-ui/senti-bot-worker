// scripts/lang-autotest.ts
// Простий автотест для normalizeLang: проганяє набір кейсів і фейлить CI, якщо щось не збіглося.

import { normalizeLang, type Lang } from "../src/utils/i18n";

type Case = {
  input: string;
  tg?: string;           // Telegram language_code (опц.)
  expect: Lang;
  note?: string;
};

const cases: Case[] = [
  // === RU ===
  { input: "Привет! Как дела?", expect: "ru", note: "RU strong trigger" },
  { input: "/ask Привет! Как дела?", expect: "ru", note: "Strip /ask + RU" },
  { input: "Поможешь настроить сервер?", expect: "ru", note: "RU_COMMON: поможешь + сервер" },
  { input: "Да", expect: "ru", note: "manual override RU 'да'" },

  // === UK ===
  { input: "Привіт! Як справи?", expect: "uk", note: "UK strong trigger" },
  { input: "Можеш допомогти налаштувати сервер?", expect: "uk", note: "UK_COMMON: допомогти/налаштувати/сервер" },
  { input: "Так", expect: "uk", note: "manual override UK 'так'" },
  { input: "Плануй свій день наперед", expect: "uk", note: "UK_COMMON: плануй" },

  // === DE ===
  { input: "Hallo! Wie geht’s?", expect: "de", note: "DE strong trigger + diacritics" },
  { input: "Gib einen kurzen Tipp zum Zeitmanagement.", expect: "de", note: "DE_COMMON" },

  // === EN ===
  { input: "Hi there!", expect: "en", note: "EN strong trigger" },
  { input: "Give one quick tip for productivity.", expect: "en", note: "EN_COMMON" },

  // === Ambiguous short words — вирішуємо tgLanguageCode ===
  { input: "Окей", expect: "uk", tg: "uk", note: "ambiguous Cyrillic 'Окей' → fallback to tg=uk" },
  { input: "Окей", expect: "ru", tg: "ru", note: "ambiguous Cyrillic 'Окей' → fallback to tg=ru" },

  // === Mixed / noise ===
  { input: "Начни с расстановки приоритетов.", expect: "ru", note: "RU_COMMON: приоритетов" },
  { input: "Завжди пріоритизуй завдання.", expect: "uk", note: "UK_COMMON: завданн" },

  // === Latin vs Cyrillic dominance ===
  { input: "Please help with server setup", expect: "en", note: "Latin-only" },
  { input: "Сервер і дані", expect: "uk", note: "Cyrillic + UK letters" },

  // === Edge: very short + tg fallback ===
  { input: "ok", expect: "en", note: "Latin short → EN" },
  { input: "ок", expect: "uk", tg: "uk", note: "Cyrillic short, no strong markers → tg=uk" },
];

function pad(s: string, w: number) {
  return (s.length >= w) ? s : (s + " ".repeat(w - s.length));
}

let fail = 0;
const rows: string[] = [];
rows.push(
  pad("EXPECT", 6) + "  " +
  pad("GOT", 6) + "  " +
  pad("TG", 4) + "  " +
  "INPUT" + "  —  NOTE"
);

for (const c of cases) {
  const got = normalizeLang(c.input, c.tg);
  const ok = got === c.expect;
  if (!ok) fail++;
  rows.push(
    pad(c.expect, 6) + "  " +
    pad(got, 6) + "  " +
    pad(c.tg ?? "-", 4) + "  " +
    c.input + "  —  " + (c.note ?? "")
  );
}

const header =
  `\n=== normalizeLang Autotest ===\n` +
  `Total: ${cases.length}  |  Passed: ${cases.length - fail}  |  Failed: ${fail}\n`;

console.log(header);
console.log(rows.join("\n"));
console.log("\nDetails:\n- RU cases check strong triggers and RU_COMMON\n- UK cases check strong triggers, UK letters (і, ї, є, ґ), та слова з UK_COMMON\n- DE uses diacritics/strong words; EN uses strong/common words\n- Ambiguous short words fall back to Telegram language_code as per implementation\n");

if (fail > 0) {
  console.error(`❌ Tests failed: ${fail}`);
  // Нехай CI падає
  process.exit(1);
} else {
  console.log("✅ All tests passed.");
  process.exit(0);
}