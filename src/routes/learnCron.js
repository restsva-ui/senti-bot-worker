// src/routes/learnCron.js
import { json } from "../utils/http.js";
import { processOne, storeSummaryRolling } from "../lib/learnQueue.js";

export async function handleLearnCron(req, env, url){
  if (req.method !== "GET") return json({ok:false, error:"method"}, 405);
  if (env.WEBHOOK_SECRET){
    const s = url.searchParams.get("s") || "";
    if (s !== env.WEBHOOK_SECRET) return json({ok:false, error:"unauthorized"}, 401);
  }
  const max = Number(url.searchParams.get("n")||"3");
  const results = [];
  for (let i=0;i<max;i++){
    const r = await processOne(env, env.MODEL_ORDER);
    if (!r?.done) break;
    results.push(r);
    if (r?.ok && r?.summary){
      await storeSummaryRolling(env, { ts:new Date().toISOString(), source:r.item, summary:r.summary });
    }
  }
  return json({ ok:true, processed: results.length, results });
}