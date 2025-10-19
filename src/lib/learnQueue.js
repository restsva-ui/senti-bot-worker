// src/lib/learnQueue.js
import { askAnyModel } from "./modelRouter.js";
import { think } from "./brain.js";
import { appendChecklist } from "./kvChecklist.js";

const KEY_USER_PREFIX = (u) => `user:${u}:queue`;
const KEY_SYSTEM = "system:queue";

// зберігаємо масив об'єктів: {id, ts, type, url|name, by}
function nowISO(){return new Date().toISOString();}

export async function listUser(env, uid){
  const raw = await env.LEARN_QUEUE_KV.get(KEY_USER_PREFIX(uid));
  return raw ? JSON.parse(raw) : [];
}
export async function saveUser(env, uid, arr){
  await env.LEARN_QUEUE_KV.put(KEY_USER_PREFIX(uid), JSON.stringify(arr));
}
export async function clearUser(env, uid){
  await env.LEARN_QUEUE_KV.delete(KEY_USER_PREFIX(uid));
}

export async function listSystem(env){
  const raw = await env.LEARN_QUEUE_KV.get(KEY_SYSTEM);
  return raw ? JSON.parse(raw) : [];
}
export async function saveSystem(env, arr){
  await env.LEARN_QUEUE_KV.put(KEY_SYSTEM, JSON.stringify(arr));
}

export async function enqueueUrl(env, uid, url){
  const it = { id: crypto.randomUUID(), ts: nowISO(), type:"url", url, by: uid };
  const user = await listUser(env, uid);
  user.push(it);
  await saveUser(env, uid, user);
  return it;
}
export async function enqueueFile(env, uid, name, tempUrl){
  const it = { id: crypto.randomUUID(), ts: nowISO(), type:"file", name, url: tempUrl, by: uid };
  const user = await listUser(env, uid);
  user.push(it);
  await saveUser(env, uid, user);
  return it;
}

// Перенести з користувацьких до системної (для фонової обробки)
export async function promoteUserItems(env, uid){
  const user = await listUser(env, uid);
  if (!user.length) return 0;
  const sys = await listSystem(env);
  const moved = user.splice(0, user.length);
  await saveUser(env, uid, user);
  await saveSystem(env, sys.concat(moved));
  return moved.length;
}

export async function processOne(env, modelOrder){
  const sys = await listSystem(env);
  if (!sys.length) return {done:false};
  const item = sys.shift();
  await saveSystem(env, sys);

  // ледь-полегшений підхід: для URL просимо модель витягти корисне і стиснути
  const model = modelOrder || env.MODEL_ORDER || "";
  const systemHint = "You are Senti. Read the provided resource and produce a compact knowledge memo: 3–6 bullets with key takeaways and 1–2 suggested questions to ask next time. Keep it neutral and helpful.";
  let prompt;

  if (item.type === "url"){
    prompt = `Study this URL and summarize:\n${item.url}\n\nReturn:\n- 3–6 bullets of key points\n- 1–2 suggested next questions`;
  } else {
    prompt = `Study this content (temporary URL):\n${item.url}\nName: ${item.name}\n\nReturn:\n- 3–6 bullets of key points\n- 1–2 suggested next questions`;
  }

  let out;
  try{
    out = model ? await askAnyModel(env, model, prompt, { systemHint })
                : await think(env, prompt, { systemHint });
  }catch(e){
    await appendChecklist(env, `learn:fail ${item.type}:${item.url||item.name} — ${String(e).slice(0,140)}`);
    return {done:true, item, ok:false, error:String(e)};
  }

  const summary = String(out||"").trim();
  await env.LEARN_QUEUE_KV.put(`summary:${item.id}`, JSON.stringify({
    ts: nowISO(),
    by: item.by,
    type: item.type,
    url: item.url || null,
    name: item.name || null,
    summary
  }));
  await appendChecklist(env, `🧠 learn:ok ${item.type}:${item.url||item.name}`);

  return {done:true, ok:true, item, summary};
}

export async function latestSummaries(env, limit=5){
  // дуже просто: KV list не доступний, тож зберігаємо останній індекс
  const idx = Number((await env.LEARN_QUEUE_KV.get("summary:index"))||"0");
  const arr = [];
  for (let i=idx;i>0 && arr.length<limit;i--){
    const raw = await env.LEARN_QUEUE_KV.get(`summary-id:${i}`);
    if (!raw) continue;
    arr.push(JSON.parse(raw));
  }
  return arr;
}

// допоміжна функція для запису з автоінкрементом у «історію»
export async function storeSummaryRolling(env, payload){
  const idx = Number((await env.LEARN_QUEUE_KV.get("summary:index"))||"0")+1;
  await env.LEARN_QUEUE_KV.put(`summary-id:${idx}`, JSON.stringify(payload));
  await env.LEARN_QUEUE_KV.put("summary:index", String(idx));
}