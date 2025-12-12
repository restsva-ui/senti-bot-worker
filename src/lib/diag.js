// src/lib/diag.js
// Легка діагностична обгортка для flow-функцій.
// Мета: не падати, а повертати дружній текст + (опційно) diag-позначку.

function diagEnabled(env) {
  return String(env?.DIAG_TAGS || "").toLowerCase() === "on";
}

function toErrText(err) {
  if (!err) return "unknown_error";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Повертає текст з diag-суфіксом (якщо DIAG_TAGS=on)
 */
export function diagText(env, baseText, tag, err) {
  const base = baseText || "Сталася помилка. Спробуй ще раз пізніше.";
  if (!diagEnabled(env)) return base;
  const e = toErrText(err);
  const t = tag ? String(tag) : "diag";
  return `${base}\n(diag: ${t}; ${e})`;
}

/**
 * Обгортка: ловить помилки й повертає fallback-текст (string).
 *
 * Підтримує виклики:
 *   diagWrap("tag", async (env, msg, lang) => "ok")
 *   diagWrap({ tag:"tag", fallback:"..." }, async (...) => "ok")
 */
export function diagWrap(a, b) {
  let tag = "diag";
  let fallback =
    "Не вдалося виконати дію. Спробуй ще раз пізніше.";

  let fn;

  if (typeof a === "string" && typeof b === "function") {
    tag = a;
    fn = b;
  } else if (typeof a === "object" && typeof b === "function") {
    tag = a?.tag || tag;
    fallback = a?.fallback || fallback;
    fn = b;
  } else if (typeof a === "function") {
    fn = a;
  } else {
    throw new Error("diagWrap: invalid arguments");
  }

  return async function wrapped(...args) {
    // У твоїх flow зазвичай 1-й аргумент — env
    const env = args?.[0];
    try {
      return await fn(...args);
    } catch (err) {
      return diagText(env, fallback, tag, err);
    }
  };
}