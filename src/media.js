// src/media.js — friendly replies for stickers/gifs & media hints

export async function handleMedia(env, { chatId, replyLang, mode }) {
  // НІЯКИХ привітань тут — щоб не дублювалося з Greeting.
  if (mode === "hint") {
    // index.js сам відправить підказку tgReplyMediaHint(); тут нічого не повертаємо
    return { text: null };
  }

  if (mode === "friendly") {
    const msg =
      replyLang === "uk" ? "Гарний настрій бачу 😄" :
      replyLang === "ru" ? "Классное настроение вижу 😄" :
      replyLang === "de" ? "Gute Stimmung sehe ich 😄" :
      replyLang === "fr" ? "Bonne vibe, je vois 😄" :
      "Nice vibe 😄";
    return { text: msg };
  }

  return { text: null };
}
