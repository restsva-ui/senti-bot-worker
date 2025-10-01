// src/utils/i18n.ts

/** Підтримувані коди мов у боті */
export type Lang = "uk" | "ru" | "de" | "en";

/** Нормалізація коду мови Telegram у наш набір */
export function normalizeLang(langCode?: string): Lang {
  if (!langCode) return "en";
  const lc = String(langCode).toLowerCase();

  // Українська
  if (lc === "uk" || lc.startsWith("uk-") || lc === "uk_ua" || lc === "uk-ua")
    return "uk";

  // Російська
  if (lc === "ru" || lc.startsWith("ru-") || lc === "ru_ru" || lc === "ru-ru")
    return "ru";

  // Німецька (враховуємо різні регіони)
  if (
    lc === "de" ||
    lc.startsWith("de-") ||
    lc === "de_de" ||
    lc === "de-at" ||
    lc === "de-ch" ||
    lc === "de_de"
  )
    return "de";

  // Фолбек
  return "en";
}

/** Зручна утиліта: обрати значення з мапи за мовою користувача */
export function pickByLang<T>(
  dict: Record<Lang, T>,
  langCode?: string,
  fallback: Lang = "en",
): T {
  const l = normalizeLang(langCode);
  return dict[l] ?? dict[fallback];
}

/** (Необов’язково) Витягнути мову з Telegram update */
export function detectLangFromUpdate(update: any): Lang {
  const code: string | undefined =
    update?.message?.from?.language_code ??
    update?.callback_query?.from?.language_code ??
    update?.from?.language_code;
  return normalizeLang(code);
}