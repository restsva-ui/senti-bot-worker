// Плейсхолдери AI, щоб білд не падав. Потім підкинемо реальні провайдери (Gemini/DeepSeek/Groq).

export async function aiText({ prompt, system, env }) {
  // Тут може бути виклик до будь-якого LLM. Поки повертаємо просту відповідь.
  const prefix = system ? `${system}\n\n` : '';
  return `${prefix}Готово! Я отримав твій запит і відповім простими словами:\n\n${prompt ? `• ${prompt}` : '• (порожній запит)'}`;
}

export async function aiVision({ imageUrl, prompt, env }) {
  // Заглушка для vision — повертаємо опис того, що нам передали.
  return `Бачу зображення (${imageUrl ? imageUrl : 'без URL'}). ${prompt ? `Підказка: ${prompt}` : ''}`;
}