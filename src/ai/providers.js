/**
 * aiText — базова відповідь на текстовий запит.
 * Тут можна під’єднати будь-який LLM. Поки — безпечна заглушка.
 */
export async function aiText(env, prompt, opts = {}) {
  // TODO: замінити на реальний виклик LLM (Gemini/DeepSeek/…)
  // Наприклад, якщо є OPENROUTER_API_KEY — можна зробити fetch(...)
  const trimmed = String(prompt ?? "").slice(0, 4000);
  return `🤖 Відповідь: ${trimmed ? "я почув: " + trimmed : "надійшли, будь ласка, текст"}.`;
}

/**
 * aiVision — «опис/аналіз» зображення або файлу за URL.
 * Поки — заглушка, яка формує дружню відповідь.
 */
export async function aiVision(env, url, prompt = "") {
  const p = String(prompt ?? "").slice(0, 500);
  const shortUrl = String(url ?? "").slice(0, 120);
  // TODO: замінити на реальний виклик vision-моделі (Gemini Vision/Claude Vision/…)
  return [
    "🖼️ Я отримав файл/зображення.",
    shortUrl ? `URL: ${shortUrl}` : null,
    p ? `Запит: ${p}` : null,
    "",
    "Поки що відповідаю базово. Хочеш — під’єднаю «справжній» vision і зроблю детальний опис.",
  ]
    .filter(Boolean)
    .join("\n");
}