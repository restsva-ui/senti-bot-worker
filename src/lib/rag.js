// src/lib/rag.js
// Дуже легкий RAG: зберігаємо перші ~32KB тексту файлу у KV, робимо примітивний пошук по ключовим словам.

const RAG_NS = "TODO_KV"; // використовуємо вже наявний KV (можеш змінити на окремий)
const PREFIX = "rag:index:";

function ensureKV(env) {
  const kv = env[RAG_NS];
  if (!kv) throw new Error(`${RAG_NS} binding missing`);
  return kv;
}

export const RAG = {
  async ingest(env, listFn, readFn) {
    const kv = ensureKV(env);
    const files = await listFn(); // [{id,name,mimeType}]
    let count = 0;
    for (const f of files) {
      // індексуємо тільки текстові типи (markdown, txt, code); pdf/docx тут пропускаємо
      const isTextGuess = /\.(md|markdown|txt|js|ts|json|yml|yaml|toml|html|css|tsx?|jsx?)$/i.test(f.name || "");
      if (!isTextGuess) continue;
      const text = await readFn(f.id, 32 * 1024);
      if (!text) continue;
      const key = `${PREFIX}${f.id}`;
      const payload = { id: f.id, name: f.name, snippet: text.slice(0, 2000) };
      await kv.put(key, JSON.stringify(payload));
      count++;
    }
    await kv.put(`${PREFIX}list`, JSON.stringify((files||[]).map(x=>x.id)));
    return { ok:true, indexed: count };
  },

  async search(env, query, limit=4) {
    const kv = ensureKV(env);
    const listRaw = await kv.get(`${PREFIX}list`);
    if (!listRaw) return [];
    const ids = JSON.parse(listRaw);
    const terms = String(query||"").toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const id of ids) {
      const raw = await kv.get(`${PREFIX}${id}`);
      if (!raw) continue;
      const doc = JSON.parse(raw);
      const hay = `${doc.name}\n${doc.snippet}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score++;
      if (score>0) scored.push({ score, ...doc, title: doc.name });
    }
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0, limit);
  }
};