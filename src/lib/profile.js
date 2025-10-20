// src/lib/profile.js

/**
 * Парсимо ім'я з фраз типу:
 *  - мене звати <Ім'я>
 *  - меня зовут <Имя>
 *  - my name is <Name>
 *  - ich heiße <Name> / ich heisse <Name>
 *  - je m'appelle <Name>
 */
export function tryParseUserNamedAs(text) {
  const s = (text || "").trim();
  const NAME_RX = "([A-Za-zÀ-ÿĀ-žЀ-ӿʼ'`\\-\\s]{2,30})";
  const patterns = [
    new RegExp(`\\bмене\\s+звати\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bменя\\s+зовут\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bmy\\s+name\\s+is\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bich\\s+hei(?:s|ß)e\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bje\\s+m'?appelle\\s+${NAME_RX}`, "iu")
  ];
  for (const r of patterns) {
    const m = s.match(r);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

const PROFILE_NAME_KEY = (uid) => `profile:name:${uid}`;

/** Отримати збережене ім'я з KV, або fallback з TG-профілю */
export async function getPreferredName(env, msg) {
  const uid = msg?.from?.id;
  const kv = env?.STATE_KV;
  let v = null;
  try { v = await kv.get(PROFILE_NAME_KEY(uid)); } catch {}
  if (v) return v;
  return msg?.from?.first_name || msg?.from?.username || "друже";
}

/** Запам'ятати ім'я з тексту, якщо воно згадане природно у фразі */
export async function rememberNameFromText(env, userId, text) {
  const name = tryParseUserNamedAs(text);
  if (!name) return null;
  try { await env.STATE_KV.put(PROFILE_NAME_KEY(userId), name); } catch {}
  return name;
}