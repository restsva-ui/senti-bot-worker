// src/lib/i18n.js
// ⬇️ короткий, самодостатній i18n (залишив існуючі ключі; додав потрібні)

const DICT = {
  uk: {
    hello_name: (n) => `Привіт, ${n}!`,
    how_help: "Чим можу допомогти?",
    default_reply: "Вибач, сталася помилка. Спробуй ще раз.",
    senti_tip: "Напиши запит після /ai або просто текстом.",
    open_drive_btn: "Відкрити Drive",
    saved_to_drive: "Збережено в Google Drive",
    need_energy_text: (need, url) => `Потрібно ${need} ⚡ для відповіді. Поповнити: ${url}`,
    need_energy_media: (need, url) => `Потрібно ${need} ⚡ для збереження/аналізу медіа. Поповнити: ${url}`,
    low_energy_notice: (left, url) => `Залишилось ${left} ⚡. Керувати: ${url}`,
    admin_header: "Admin panel (quick diagnostics):",
    learn_mode_hint: "🧠 Режим навчання. Надішли посилання на статтю/відео або файл (PDF, DOCX, TXT) — додам у чергу навчання.",
    learn_enqueued: (n) => `✅ Додано ${n} матеріал(и) до черги навчання.`,
  },
  en: {
    hello_name: (n) => `Hi, ${n}!`,
    how_help: "How can I help?",
    default_reply: "Sorry, something went wrong. Please try again.",
    senti_tip: "Send a prompt after /ai or just type your message.",
    open_drive_btn: "Open Drive",
    saved_to_drive: "Saved to Google Drive",
    need_energy_text: (need, url) => `Need ${need} ⚡ to answer. Refill: ${url}`,
    need_energy_media: (need, url) => `Need ${need} ⚡ to save/analyze media. Refill: ${url}`,
    low_energy_notice: (left, url) => `Left ${left} ⚡. Manage: ${url}`,
    admin_header: "Admin panel (quick diagnostics):",
    learn_mode_hint: "🧠 Learning mode. Send me a link to an article/video or attach a file (PDF, DOCX, TXT) — I’ll queue it for learning.",
    learn_enqueued: (n) => `✅ Added ${n} item(s) to learning queue.`,
  },
  ru: {
    hello_name: (n) => `Привет, ${n}!`,
    how_help: "Чем могу помочь?",
    default_reply: "Извини, возникла ошибка. Попробуй ещё раз.",
    senti_tip: "Напиши вопрос после /ai или просто текстом.",
    open_drive_btn: "Открыть Drive",
    saved_to_drive: "Сохранено в Google Drive",
    need_energy_text: (need, url) => `Нужно ${need} ⚡ для ответа. Пополнить: ${url}`,
    need_energy_media: (need, url) => `Нужно ${need} ⚡ для сохранения/анализа медиа. Пополнить: ${url}`,
    low_energy_notice: (left, url) => `Осталось ${left} ⚡. Управление: ${url}`,
    admin_header: "Admin panel (quick diagnostics):",
    learn_mode_hint: "🧠 Режим обучения. Пришли ссылку на статью/видео или файл (PDF, DOCX, TXT) — добавлю в очередь обучения.",
    learn_enqueued: (n) => `✅ Добавлено ${n} материал(ов) в очередь обучения.`,
  },
  de: {
    hello_name: (n) => `Hallo, ${n}!`,
    how_help: "Wobei kann ich helfen?",
    default_reply: "Entschuldige, etwas ist schiefgelaufen. Bitte erneut versuchen.",
    senti_tip: "Schreibe nach /ai oder direkt deine Nachricht.",
    open_drive_btn: "Drive öffnen",
    saved_to_drive: "In Google Drive gespeichert",
    need_energy_text: (need, url) => `Benötigt ${need} ⚡. Aufladen: ${url}`,
    need_energy_media: (need, url) => `Benötigt ${need} ⚡ für Medien. Aufladen: ${url}`,
    low_energy_notice: (left, url) => `Verbleiben ${left} ⚡. Verwalten: ${url}`,
    admin_header: "Admin panel (quick diagnostics):",
    learn_mode_hint: "🧠 Lernmodus. Sende einen Link zu Artikel/Video oder eine Datei (PDF, DOCX, TXT) – ich stelle es in die Lernwarteschlange.",
    learn_enqueued: (n) => `✅ ${n} Element(e) zur Lernwarteschlange hinzugefügt.`,
  },
  fr: {
    hello_name: (n) => `Salut, ${n} !`,
    how_help: "Comment puis-je aider ?",
    default_reply: "Désolé, un souci est survenu. Réessaie.",
    senti_tip: "Écris après /ai ou envoie ton message.",
    open_drive_btn: "Ouvrir Drive",
    saved_to_drive: "Enregistré dans Google Drive",
    need_energy_text: (need, url) => `Il faut ${need} ⚡ pour répondre. Recharger : ${url}`,
    need_energy_media: (need, url) => `Il faut ${need} ⚡ pour enregistrer/analyser un média. Recharger : ${url}`,
    low_energy_notice: (left, url) => `Il reste ${left} ⚡. Gérer : ${url}`,
    admin_header: "Admin panel (quick diagnostics):",
    learn_mode_hint: "🧠 Mode apprentissage. Envoie un lien vers un article/une vidéo ou un fichier (PDF, DOCX, TXT) – je l’ajoute à la file d’apprentissage.",
    learn_enqueued: (n) => `✅ ${n} élément(s) ajouté(s) à la file d’apprentissage.`,
  }
};

export function t(lang, key, ...args) {
  const L = (DICT[lang] && DICT[lang][key]) || (DICT.uk && DICT.uk[key]) || key;
  return (typeof L === "function") ? L(...args) : L;
}

// Визначення мови відповіді:
//   1) мова профілю Telegram
//   2) детект з тексту (якщо явно інша)
//   3) дефолт — uk
export function pickReplyLanguage(msg, rawText = "") {
  const prof = (msg?.from?.language_code || "").slice(0,2).toLowerCase();
  const fromProf = ["uk","ru","en","de","fr"].includes(prof) ? prof : null;

  const alt = detectFromText(rawText);
  if (alt && alt !== fromProf) return alt;
  return fromProf || "uk";
}

// Дуже легкий детект
export function detectFromText(s="") {
  const x = s.toLowerCase();
  if (/[а-яёїієґ]/i.test(x) && /[ыэёъ]/.test(x) === false) return "uk";
  if (/[а-яё]/i.test(x)) return "ru";
  if (/[a-z]/i.test(x)) return "en";
  if (/[äöüß]/i.test(x)) return "de";
  if (/[éèàùçôî]/i.test(x)) return "fr";
  return null;
}