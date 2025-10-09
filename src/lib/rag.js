// src/lib/rag.js
const IDX_KEY = "drive_idx"; // одна структура в TODO_KV
function ensureKV(env){ if(!env.TODO_KV) throw new Error("TODO_KV missing"); return env.TODO_KV; }
const MAX_BYTES = 32 * 1024; // забираємо тільки «хед» контенту для пошуку

export const RAG = {
  async ingest(env, listFn, readFn){
    const kv = ensureKV(env);
    const files = await listFn(); // [{id,name,mimeType}, ...]
    const items = [];
    for (const f of files) {
      if (!/text|markdown|json|csv|xml|html|plain|application\/pdf/i.test(f.mimeType||"")) continue;
      try {
        const head = await readFn(f.id, MAX_BYTES); // повертає String першої частини
        items.push({id:f.id, name:f.name, mt:f.mimeType, head});
      } catch {}
    }
    await kv.put(IDX_KEY, JSON.stringify({ ts:Date.now(), items }), {expirationTtl: 60*60}); // 1 год
    return {count: items.length};
  },

  async search(env, q, k=4){
    const kv = ensureKV(env);
    const raw = await kv.get(IDX_KEY);
    if(!raw) return [];
    const {items=[]} = JSON.parse(raw);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = items.map(it=>{
      const hay = `${it.name}\n${it.head||""}`.toLowerCase();
      const score = terms.reduce((s,t)=> s + (hay.includes(t) ? 1 : 0), 0) + (hay.indexOf(terms[0]||"")===0?0.5:0);
      return {score, it};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,k);
    return scored.map(s=>`# ${s.it.name}\n${(s.it.head||"").slice(0,1200)}`);
  }
};