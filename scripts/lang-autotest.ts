/* scripts/lang-autotest.ts
 * Запуск:  npx tsx scripts/lang-autotest.ts
 */
import assert from "node:assert/strict";
import { normalizeLang, type Lang } from "../src/utils/i18n";
import { quickTemplateReply } from "../src/services/replier";

// ---- helpers
function test(name: string, fn: () => void | Promise<void>) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log("✅", name))
    .catch((e) => {
      console.error("❌", name);
      console.error(e instanceof Error ? e.stack : e);
      process.exitCode = 1;
    });
}

function expectLang(text: string, exp: Lang, tg?: string) {
  const got = normalizeLang(text, tg);
  assert.equal(got, exp, `expected ${exp}, got ${got} for: ${text}`);
}

// ---- normalizeLang cases
test("UA: прості слова/фрази", () => {
  expectLang("Привіт!", "uk");
  expectLang("/ask Як справи?", "uk");
  expectLang("Можеш допомогти налаштувати сервер?", "uk");
  expectLang("/ask Дай одну швидку пораду з тайм-менеджменту.", "uk");
});

test("RU: прості слова/фрази", () => {
  expectLang("Привет!", "ru");
  expectLang("/ask Поможешь настроить сервер?", "ru");
  expectLang("Дай один быстрый совет по учебе.", "ru");
});

test("DE: прості слова/фрази", () => {
  expectLang("Hallo! Wie geht’s?", "de");
  expectLang("/ask Ja", "de");
  expectLang("Gib einen kurzen Tipp zum Zeitmanagement.", "de");
});

test("EN: прості слова/фрази", () => {
  expectLang("Hi!", "en");
  expectLang("/ask Give me 2 quick tips to stay focused.", "en");
  expectLang("Give one quick tip for productivity.", "en");
});

test("Змішані /ask-блоки в одному повідомленні — кожен окремо", () => {
  // це не реальний парсер, а перевірка на фрагменти, які ви передаєте окремо
  expectLang("Так", "uk");
  expectLang("Да", "ru");
  expectLang("Ja", "de");
  expectLang("Yes", "en");
});

test("Кирилиця без явних UA-літер → RU; з UA-літерами → UK", () => {
  expectLang("Поможешь с сервером?", "ru");
  expectLang("Допоможеш з сервером?", "uk");
});

test("DE діакритика — одразу DE", () => {
  expectLang("Möchte einen Tipp.", "de");
});

test("EN латиниця без діакритики — EN", () => {
  expectLang("please help", "en");
});

// ---- quick templates
test("Швидкі відповіді — UA", () => {
  const r = quickTemplateReply("uk", "Привіт");
  assert.ok(r && /Привіт/i.test(r));
});

test("Швидкі відповіді — RU", () => {
  const r = quickTemplateReply("ru", "Окей!");
  assert.ok(r && /Окей/i.test(r));
});

test("Швидкі відповіді — DE", () => {
  const r = quickTemplateReply("de", "Ja");
  assert.ok(r && /Alles klar/i.test(r));
});

test("Швидкі відповіді — EN", () => {
  const r = quickTemplateReply("en", "Thanks");
  assert.ok(r && /welcome/i.test(r));
});

// ---- askSmart language lock: unit-test з моком
// Ми не імпортуємо askSmart напряму, щоб не тягнути мережу.
// Замість цього — “контрактний” тест: переконуємося, що normalizeLang
// покарає відповідь не тією мовою (це те, що askSmart перевіряє).

test("Контроль: відповідь іншою мовою буде розпізнана як інша", () => {
  assert.equal(normalizeLang("Hello, here is your tip", undefined), "en");
  assert.equal(normalizeLang("Привіт! Ось порада", undefined), "uk");
  assert.equal(normalizeLang("Привет! Вот совет", undefined), "ru");
  assert.equal(normalizeLang("Hallo! Tipp:", undefined), "de");
});