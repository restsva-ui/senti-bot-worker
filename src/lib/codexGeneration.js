// src/codexGeneration.js
// Ядро генерації Codex: Architect + робота з медіа

import { askAnyModel, askVision } from "./modelRouter.js";
import { codexUploadAssetFromUrl } from "./codexDrive.js";

import {
  pickKV,
  nowIso,
  extractTextFromModel,
  limitCodexText,
} from "./codexUtils.js";

import {
  createProject,
  readMeta,
  readSection,
  appendSection,
  setCurrentProject,
  getCurrentProject,
  UI_AWAIT_KEY,
} from "./codexState.js";

import { handleCodexCommand } from "./codexUi.js";

// -------------------- vision-аналіз --------------------
async function analyzeImageForCodex(env, { lang = "uk", imageBase64, question }) {
  const system = `Ти — Senti Codex, технічний аналітик інтерфейсів та макетів. Твоє завдання:
- чітко описати, що на зображенні;
- виділити компоненти UI, сітку, блоки, ієрархію, шрифти, кольори;
- запропонувати, як це зображення може використовуватись у продукті (логотип, банер, екран, іконки тощо).
Не вигадуй код, якщо про це прямо не просять.`;

  const prompt =
    question ||
    "Опиши, що на зображенні, з фокусом на компоненти інтерфейсу, блоки, сітку, шрифти, кольори, структуру верстки.";

  const modelOrder =
    env.MODEL_ORDER_VISION ||
    env.MODEL_ORDER ||
    env.MODEL_ORDER_TEXT;

  const res = await askVision(env, modelOrder, prompt, {
    systemHint: system,
    imageBase64,
    temperature: 0.2,
  });

  const text =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content ||
        res?.text ||
        JSON.stringify(res);

  return String(text || "").slice(0, 4000);
}

// -------------------- handleCodexGeneration --------------------
export async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64 } = helpers;

  const kv = pickKV(env);
  if (!kv) {
    await sendPlain(env, chatId, "Codex KV недоступний.");
    return true;
  }

  const awaiting = (await kv.get(UI_AWAIT_KEY(userId), "text")) || "none";

  const hasPhoto = Array.isArray(msg?.photo) && msg.photo.length > 0;
  const hasDocument = !!msg?.document;

  // Якщо користувач надсилає лише медіа/файл без тексту — все одно
  // зберігаємо його як asset і одразу пропонуємо ідеї для проєкту.
  if (awaiting === "none" && !textRaw && (hasPhoto || hasDocument)) {
    await sendPlain(
      env,
      chatId,
      "Я отримав медіа/файл для Codex і додам його до активного проєкту. Зараз запропоную, як краще використати цей матеріал."
    );
    // Без return: далі Codex обробить asset і згенерує пропозиції.
  }

  // ---------- UI-стани ----------
  if (awaiting === "proj_name" && textRaw) {
    const name = textRaw.trim();
    await kv.delete(UI_AWAIT_KEY(userId));
    if (!name) {
      await sendPlain(
        env,
        chatId,
        "Назва порожня. Натисни «Створити проєкт» ще раз і введи коректну."
      );
      return true;
    }
    const metaPrev = await readMeta(env, userId, name);
    if (metaPrev) {
      await sendPlain(
        env,
        chatId,
        `Проєкт "${name}" вже існує. Обери іншу назву або користуйся існуючим.`
      );
      return true;
    }
    await createProject(env, userId, name, "");
    await sendPlain(
      env,
      chatId,
      `✅ Проєкт "${name}" створено. Тепер надсилай ідеї, посилання, матеріали — все збережу.`
    );
    await setCurrentProject(env, userId, name);
    return true;
  }

  if (awaiting === "switch_proj_name" && textRaw) {
    const name = textRaw.trim();
    await kv.delete(UI_AWAIT_KEY(userId));
    const meta = await readMeta(env, userId, name);
    if (!meta) {
      await sendPlain(
        env,
        chatId,
        `Проєкт "${name}" не знайдено. Перевір назву або обери проєкт з меню.`
      );
      return true;
    }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `✅ Активний проєкт: "${name}".`);
    return true;
  }

  // Якщо це команда /project ... — віддаємо в codexUi
  if (/^\/project\b/i.test(textRaw || "")) {
    const handled = await handleCodexCommand(env, ctx, helpers);
    if (handled) return true;
  }

  // ---------- основна логіка генерації ----------
  const curName = await getCurrentProject(env, userId);
  if (!curName) {
    await sendPlain(
      env,
      chatId,
      "Спочатку створи або обери проєкт у Codex (кнопки під повідомленням)."
    );
    return true;
  }

  const meta = await readMeta(env, userId, curName);
  if (!meta) {
    await sendPlain(
      env,
      chatId,
      `Метадані проєкту "${curName}" не знайдено. Спробуй переобрати проєкт.`
    );
    return true;
  }

  // Читаємо основні секції проєкту
  const [ideaMd, tasksMd, progressMd] = await Promise.all([
    readSection(env, userId, curName, "idea.md"),
    readSection(env, userId, curName, "tasks.md"),
    readSection(env, userId, curName, "progress.md"),
  ]);

  const idea = ideaMd || meta.idea || "";
  const tasks = tasksMd || "";
  const progress = progressMd || "";

  const userText = (textRaw || "").trim();

  // -------------------- робота з медіа / файлами --------------------
  const assetsSaved = [];

  if (hasPhoto) {
    const photo = pickPhoto(msg); // ВАЖЛИВО: передаємо весь msg, а не msg.photo
    if (photo) {
      const url = await tgFileUrl(env, photo.file_id);
      const base64 = await urlToBase64(url);
      if (base64) {
        // vision-аналіз
        const visionSummary = await analyzeImageForCodex(env, {
          lang,
          imageBase64: base64,
          question: null,
        });
        assetsSaved.push({
          type: "image",
          url,
          visionSummary,
        });

        // зберігаємо короткий опис у progress
        await appendSection(
          env,
          userId,
          curName,
          "progress.md",
          `- ${nowIso()} — додано зображення (Codex Vision): ${visionSummary.slice(
            0,
            200
          )}…`
        );

        // За можливості завантажуємо в сховище Codex
        try {
          await codexUploadAssetFromUrl(env, userId, curName, {
            url,
            kind: "image",
            filename: photo.name,
          });
        } catch {
          // тихо ігноруємо помилки завантаження asset
        }
      }
    }
  }

  if (hasDocument) {
    const doc = msg.document;
    if (doc && doc.file_id) {
      const url = await tgFileUrl(env, doc.file_id);

      assetsSaved.push({
        type: "file",
        url,
        name: doc.file_name || "",
        mime: doc.mime_type || "",
      });

      await appendSection(
        env,
        userId,
        curName,
        "progress.md",
        `- ${nowIso()} — додано файл: ${doc.file_name || "без назви"} (${doc.mime_type || "тип невідомий"})`
      );

      try {
        await codexUploadAssetFromUrl(env, userId, curName, {
          url,
          kind: "file",
          filename: doc.file_name || "asset",
        });
      } catch {
        // ігноруємо помилки
      }
    }
  }

  // Витягуємо URL з тексту, якщо є
  const urlRegex = /(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/gi;
  const urls = [];
  if (userText) {
    let m;
    while ((m = urlRegex.exec(userText))) {
      urls.push(m[0]);
    }
  }
  // -------------------- побудова промпту для моделі --------------------
  const parts = [];

  parts.push(
    "Ти — Senti Codex 3.2 (Dialogue Architect) для цього проєкту. Працюй у діалоговому режимі."
  );
  parts.push(
    "Твоє завдання — допомагати крок за кроком: коротко пояснювати стан проєкту, пропонувати покращення і ставити уточнюючі питання."
  );
  parts.push(
    "ФОКУС: UX, флоу користувача, структура продукту, контент, архітектура, пріоритизація задач."
  );

  const systemHint = [
    "Ти — Senti Codex 3.2 (Dialogue Architect).",
    "Ти поєднуєш ролі: архітектор, senior-розробник і аналітик вимог.",
    "Працюєш у режимі проєкту; тримай у фокусі мету продукту й пропонуй еволюційні покращення, а не один гігантський документ.",
    "",
    "Діалоговий режим і загальні питання:",
    "- Якщо запит явно стосується поточного проєкту — аналізуй його з фокусом на продукт.",
    "- Якщо запит загальний (визначення слів, міст, технологій, історичних фактів тощо) — дай коротку звичайну відповідь як асистент.",
    "- Після короткої загальної відповіді можеш, за бажанням, одним реченням повʼязати її з проєктом.",
    "- НІКОЛИ не відмовляйся з формулюванням на кшталт «я не можу відповісти, бо це поза контекстом нашого проєкту». Краще дай стислу відповідь і мʼяко поверни розмову до проєкту.",
    "",
    "Формат відповіді:",
    "1) 1–2 короткі речення, що підсумовують поточний стан проєкту (або коротка відповідь на загальне питання).",
    "2) 3–5 маркованих кроків / ідей, як покращити або розвинути проєкт (функції, UX, контент, технічні задачі).",
    "3) 1 коротке запитання користувачу про наступний крок або уточнення.",
    "",
    "Режим діалогу:",
    "- Відповідь має бути стислою: до 800–1000 символів, не більше 10–12 речень.",
    "- Якщо інформації дуже багато — дай тільки найважливіше й запропонуй продовжити в наступних ітераціях.",
    "- Не вивалюй повне ТЗ чи величезні specs без прямого запиту.",
    "",
    "Код:",
    "- Спочатку опиши ідею/зміни людською мовою.",
    "- Лише потім наведи невеликий, сфокусований фрагмент коду, якщо він реально потрібен.",
    "",
    "Медіа та матеріали:",
    "- Для зображень та assets пояснюй, як саме їх краще використати в проєкті (логотип, банер, UI-макет, іконки, контент).",
    "- Якщо бачиш зовнішні посилання, але не маєш доступу до їхнього вмісту — чесно скажи, що контент невідомий.",
    "",
    "Контекст проєкту нижче. Завжди спирайся на нього:",
    "=== ІДЕЯ ПРОЄКТУ ===",
    idea || "(ще не задана)",
    "",
    "=== TASKS (task list) ===",
    tasks || "(ще немає tasks)",
    "",
    "=== PROGRESS (щоденник/журнал) ===",
    progress || "(ще не було progress-записів)",
  ].join("\n");

  parts.push("=== МЕТА ПРОЄКТУ (IDEA) ===");
  parts.push(idea || "(ще не задана)");

  if (tasks) {
    parts.push("=== TASKS (список задач) ===");
    parts.push(tasks.slice(0, 6000));
  }

  if (progress) {
    parts.push("=== PROGRESS (щоденник/історія) ===");
    parts.push(progress.slice(0, 6000));
  }

  if (assetsSaved.length) {
    parts.push("=== НОВІ МАТЕРІАЛИ (assets) ===");
    for (const a of assetsSaved) {
      if (a.type === "image") {
        parts.push(
          `ЗОБРАЖЕННЯ: ${a.url}\nОпис (Vision): ${a.visionSummary.slice(
            0,
            1000
          )}`
        );
      } else if (a.type === "file") {
        parts.push(
          `ФАЙЛ: ${a.name || "без назви"} (${a.mime || "тип невідомий"}) — ${a.url}`
        );
      }
    }
  }

  if (urls.length) {
    parts.push("=== ПОСИЛАННЯ ВІД КОРИСТУВАЧА ===");
    parts.push(urls.join("\n"));
  }

  if (userText) {
    parts.push("=== ЗАПИТ КОРИСТУВАЧА ===");
    parts.push(userText);
  } else if (!assetsSaved.length) {
    parts.push(
      "Немає явного текстового запиту. Зроби огляд поточного стану проєкту та запропонуй 3–5 наступних кроків."
    );
  }

  const finalUserPrompt = parts.join("\n\n").trim();

  const modelOrder =
    env.MODEL_ORDER_CODEX ||
    env.MODEL_ORDER_TEXT ||
    env.MODEL_ORDER ||
    "gpt-4o-mini";

  const res = await askAnyModel(env, modelOrder, finalUserPrompt, {
    systemHint,
    temperature: 0.4,
    maxTokens: 800,
  });

  const outRaw = extractTextFromModel(res);
  const outText = limitCodexText(String(outRaw || "Не впевнений."), 1600);

  const proj = await readMeta(env, userId, curName);
  if (proj && proj.name) {
    await appendSection(
      env,
      userId,
      proj.name,
      "progress.md",
      `- ${nowIso()} — Відповідь Codex: ${outText.slice(0, 120)}…`
    );
  }

  await sendPlain(env, chatId, outText);
}
