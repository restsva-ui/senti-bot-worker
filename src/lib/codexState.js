// src/lib/codexState.js
// Спрощений стан Codex: зберігаємо останні файли користувача в KV

const CODEX_HISTORY_LIMIT = 50

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || null
}

export const CODEX_MEM_KEY = uid => `codex:mem:${uid}`

/**
 * Зберігає черговий файл Codex у KV-історії користувача.
 * @param {any} env - середовище Worker (з біндінгами KV)
 * @param {string|number} uid - Telegram user id
 * @param {{filename:string, content:string}} item
 */
export async function saveCodexMem(env, uid, item) {
  const kv = pickKV(env)
  if (!kv) return

  const key = CODEX_MEM_KEY(uid)

  let history = []
  try {
    const raw = await kv.get(key, 'text')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) history = parsed
    }
  } catch {
    history = []
  }

  const entry = {
    filename: item.filename,
    content: item.content,
    ts: new Date().toISOString()
  }

  // додаємо новий зверху
  history.unshift(entry)

  // обрізаємо список
  if (history.length > CODEX_HISTORY_LIMIT) {
    history = history.slice(0, CODEX_HISTORY_LIMIT)
  }

  await kv.put(key, JSON.stringify(history))
}