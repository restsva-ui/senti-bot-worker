// src/lib/codexHandler.js
// Senti Codex: код + "Project Mode" (створення/ведення проєктів разом з юзером).
// Експорти: setCodexMode, getCodexMode, clearCodexMem,
//          buildCodexKeyboard, handleCodexUi, handleCodexCommand, handleCodexGeneration

import { askAnyModel, askVision } from "./modelRouter.js";

// -------------------- ключі в KV --------------------
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;                     // "true"/"false"
const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;                       // (зарезервовано)

const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;           // string
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`;// json
const PROJ_FILE_KEY = (uid, n, f) => `codex:project:file:${uid}:${n}:${f}`;
const PROJ_TASKSEQ_KEY = (uid, n) => `codex:project:taskseq:${uid}:${n}`;
const PROJ_PREFIX_LIST = (uid) => `codex:project:meta:${uid}:`;

// UI-стани
const UI_AWAIT_NAME = (uid) => `codex:ui:await_name:${uid}`;             // "1" | ""
const UI_AWAIT_IDEA = (uid) => `codex:ui:await_idea:${uid}`;             // <projectName> | ""

// -------------------- утиліти --------------------
function pickKV(env){ return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV || null; }
function nowIso(){ return new Date().toISOString(); }
async function kvPut(kv,k,v,ttlDays=365){ await kv.put(k,v,{expirationTtl:60*60*24*ttlDays}); }
async function kvGet(kv,k,type){ return await kv.get(k,type||"text"); }
async function kvDel(kv,k){ try{ await kv.delete(k);}catch{} }

// -------------------- codex mode --------------------
export async function setCodexMode(env, userId, on){
  const kv = pickKV(env); if(!kv) return;
  await kvPut(kv, CODEX_MODE_KEY(userId), on?"true":"false", 180);
  if(!on){ await kvDel(kv, UI_AWAIT_NAME(userId)); await kvDel(kv, UI_AWAIT_IDEA(userId)); }
}
export async function getCodexMode(env, userId){
  const kv = pickKV(env); if(!kv) return false;
  return (await kvGet(kv, CODEX_MODE_KEY(userId)))==="true";
}
export async function clearCodexMem(env, userId){
  const kv = pickKV(env); if(!kv) return;
  await kvDel(kv, CODEX_MEM_KEY(userId));
}

// -------------------- Project CRUD --------------------
async function setCurrentProject(env, userId, name){
  const kv=pickKV(env); if(!kv) return;
  await kvPut(kv, PROJ_CURR_KEY(userId), name);
}
async function getCurrentProject(env, userId){
  const kv=pickKV(env); if(!kv) return null;
  return await kvGet(kv, PROJ_CURR_KEY(userId));
}
async function saveMeta(env, userId, name, meta){
  const kv=pickKV(env); if(!kv) return;
  await kvPut(kv, PROJ_META_KEY(userId,name), JSON.stringify(meta));
}
async function readMeta(env, userId, name){
  const kv=pickKV(env); if(!kv) return null;
  const raw = await kvGet(kv, PROJ_META_KEY(userId,name));
  try{ return raw ? JSON.parse(raw) : null; }catch{ return null; }
}
async function writeSection(env, userId, name, file, content){
  const kv=pickKV(env); if(!kv) return;
  await kvPut(kv, PROJ_FILE_KEY(userId,name,file), content);
}
async function readSection(env, userId, name, file){
  const kv=pickKV(env); if(!kv) return null;
  return await kvGet(kv, PROJ_FILE_KEY(userId,name,file));
}
async function appendSection(env, userId, name, file, line){
  const prev = (await readSection(env,userId,name,file)) || "";
  const next = prev ? (prev.endsWith("\n") ? prev+line : prev+"\n"+line) : line;
  await writeSection(env,userId,name,file,next);
}
async function listProjects(env, userId){
  const kv=pickKV(env); if(!kv||!kv.list) return [];
  const out=[]; let cursor=undefined;
  do{
    const res = await kv.list({prefix: PROJ_PREFIX_LIST(userId), cursor});
    for(const k of (res.keys||[])){
      const name = k.name.split(":").pop();
      if(name && !out.includes(name)) out.push(name);
    }
    cursor = res.cursor || null;
  } while(cursor);
  return out.sort();
}
async function nextTaskId(env, userId, name){
  const kv=pickKV(env); if(!kv) return 1;
  const k=PROJ_TASKSEQ_KEY(userId,name);
  const cur=Number(await kvGet(kv,k) || "0"); const nxt=isFinite(cur)?cur+1:1;
  await kvPut(kv,k,String(nxt)); return nxt;
}

// -------------------- шаблони секцій --------------------
function templateReadme(name){ return `# ${name}\nSenti Codex Project\n\n- idea.md — контракт ідеї\n- spec.md — вимоги/архітектура\n- connectors.md — інтеграції/секрети/чеклісти\n- progress.md — журнал прогресу\n- tasks.md — TODO/DOING/DONE\n- decisions.md — ADR\n- risks.md — ризики\n- testplan.md — тести\n`; }
function templateIdea(initial=""){ return `## Ідея (контракт)\n${initial||"Опишіть бачення/цілі/обмеження."}\n\n## Матеріали\n(тут зʼявляться фото/файли, що ви надішлете)"; }
function templateSpec(){ return `# Специфікація\n- Модулі\n- API/Інтеграції\n- Дані\n- Edge/Workers/Limits\n`; }
function templateConnectors(){ return `# Інтеграції та секрети\nGEMINI_API_KEY=<set>\nCLOUDFLARE_API_TOKEN=<set>\nOPENROUTER_API_KEY=<set>\n\n## Чекліст\n- [ ] Додати ключі у Secrets/Bindings\n- [ ] Перевірити wrangler.toml\n`; }
function templateProgress(){ return `# Прогрес\n`; }
function templateTasks(){ return `# Tasks\n\n| ID | State | Title |\n|----|-------|-------|\n`; }
function templateDecisions(){ return `# ADR\n\n`; }
function templateRisks(){ return `# Ризики\n\n`; }
function templateTestplan(){ return `# Test Plan\n\n- Саніті\n- Інтеграційні\n- Приймання\n`; }

async function createProject(env, userId, name, initialIdea){
  const meta = { name, createdAt: nowIso() };
  await saveMeta(env,userId,name,meta);
  await writeSection(env,userId,name,"README.md",templateReadme(name));
  await writeSection(env,userId,name,"idea.md",templateIdea(initialIdea));
  await writeSection(env,userId,name,"spec.md",templateSpec());
  await writeSection(env,userId,name,"connectors.md",templateConnectors());
  await writeSection(env,userId,name,"progress.md",templateProgress());
  await writeSection(env,userId,name,"tasks.md",templateTasks());
  await writeSection(env,userId,name,"decisions.md",templateDecisions());
  await writeSection(env,userId,name,"risks.md",templateRisks());
  await writeSection(env,userId,name,"testplan.md",templateTestplan());
  await setCurrentProject(env,userId,name);
}

// -------------------- контекст проєкту в systemHint --------------------
async function buildProjectContext(env, userId){
  const name = await getCurrentProject(env,userId);
  if(!name) return { name:null, hint:"" };
  const idea = (await readSection(env,userId,name,"idea.md")) || "";
  const spec = (await readSection(env,userId,name,"spec.md")) || "";
  const hint =
`[Project: ${name}]
[Idea Contract]
${idea.slice(0,2500)}

[Spec (excerpt)]
${spec.slice(0,2000)}

Rules:
- Answers MUST align with "Idea Contract".
- If user's request contradicts the idea, ask to refine the idea first.`;
  return { name, hint };
}

// -------------------- клавіатура Codex --------------------
export function buildCodexKeyboard(projects = []){
  // inline-кнопки: New Project | Use/List | Status
  const row1 = [
    [{ text: "🆕 New Project", callback_data: "codex:new" }],
    [{ text: "📁 Use / List", callback_data: "codex:list" }],
    [{ text: "📊 Status", callback_data: "codex:status" }],
  ];
  // Telegram API очікує масив рядків; наш рендерер у webhook збере клавіатуру
  return { inline_keyboard: [ row1.map(x=>x[0]) ] };
}
function projectsKeyboard(all, active){
  const rows=[]; let row=[];
  for(const name of all){
    const t = (name===active?`⭐ ${name}`:name);
    row.push({ text:t, callback_data:`codex:use:${name}` });
    if(row.length===2){ rows.push(row); row=[]; }
  }
  if(row.length) rows.push(row);
  return { inline_keyboard: rows };
}
// -------------------- енергія --------------------
async function ensureEnergy(env, helpers, userId, chatId, kind){
  const { getEnergy, spendEnergy, energyLinks, sendPlain } = helpers;
  if(!getEnergy || !spendEnergy) return true;
  const cur = await getEnergy(env,userId);
  const need = kind==="image" ? Number(cur.costImage ?? 5) : Number(cur.costCodexText ?? cur.costText ?? 2);
  if((cur.energy??0) < need){
    const links = energyLinks?.(env,userId);
    await sendPlain(env, chatId, `⚡ Недостатньо енергії (${cur.energy??0}/${need}). Поповнення: ${links?.energy||"-"}`);
    return false;
  }
  await spendEnergy(env,userId,need, kind==="image"?"codex_image":"codex_text");
  return true;
}

// -------------------- UI-логіка: callback-и та стани --------------------
export async function handleCodexUi(env, chatId, userId, { cbData, msg }, helpers){
  const kv=pickKV(env); if(!kv) return false;
  const { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens } = helpers||{};

  // 1) вибір із callback-даних
  if(cbData){
    // список
    if(cbData==="codex:list"){
      const all = await listProjects(env,userId);
      const cur = await getCurrentProject(env,userId);
      if(!all.length){
        await sendPlain(env,chatId,"Немає проєктів. Натисни «New Project».");
        return true;
      }
      await sendPlain(env,chatId,"Оберіть проєкт:",{ reply_markup: projectsKeyboard(all,cur) });
      return true;
    }
    // статус
    if(cbData==="codex:status"){
      const cur = await getCurrentProject(env,userId);
      if(!cur){ await sendPlain(env,chatId,"Спочатку створіть або оберіть проєкт."); return true; }
      const idea = (await readSection(env,userId,cur,"idea.md")) || "";
      const progress = (await readSection(env,userId,cur,"progress.md")) || "";
      const tasks = (await readSection(env,userId,cur,"tasks.md")) || "";
      const body = [
        `📁 <${cur}>`,
        "",
        "— Ідея (уривок):",
        "```",
        idea.trim().slice(0,500),
        "```",
        "",
        "— Останній прогрес:",
        progress.trim().split("\n").slice(-5).join("\n") || "—",
        "",
        "— Tasks (останні рядки):",
        tasks.trim().split("\n").slice(-6).join("\n") || "—",
      ].join("\n");
      await sendPlain(env,chatId,body,{ parse_mode:"Markdown" });
      return true;
    }
    // створення
    if(cbData==="codex:new"){
      await kvPut(kv, UI_AWAIT_NAME(userId), "1");
      await kvDel(kv, UI_AWAIT_IDEA(userId));
      await sendPlain(env,chatId,"Введи назву нового проєкту (одним повідомленням).",{ reply_markup:{ force_reply:true, selective:true }});
      return true;
    }
    // активація
    if(cbData.startsWith("codex:use:")){
      const name = cbData.replace("codex:use:","");
      const all = await listProjects(env,userId);
      if(!all.includes(name)){ await sendPlain(env,chatId,"Не знайдено проєкту."); return true; }
      await setCurrentProject(env,userId,name);
      await sendPlain(env,chatId,`🔸 Активний проєкт: **${name}**`,{ parse_mode:"Markdown" });
      return true;
    }
    return false;
  }

  // 2) обробка тексту/медіа у станах
  const awaitingName = await kvGet(kv, UI_AWAIT_NAME(userId));
  if(awaitingName==="1" && msg?.text){
    const name = msg.text.trim().replace(/^<|>$/g,"");
    if(!name){ await sendPlain(env,chatId,"Назва порожня. Спробуй ще раз."); return true; }
    await kvDel(kv, UI_AWAIT_NAME(userId));
    await createProject(env,userId,name,"");
    await kvPut(kv, UI_AWAIT_IDEA(userId), name);
    await sendPlain(env,chatId,`✅ Проєкт **${name}** створено.\nОпиши ідею (можна текст + медіа/файли).`,{ parse_mode:"Markdown" });
    return true;
  }

  const collectingFor = await kvGet(kv, UI_AWAIT_IDEA(userId));
  if(collectingFor){
    // текст → в idea.md
    if(msg?.text){
      await appendSection(env,userId,collectingFor,"idea.md",`\n${msg.text.trim()}`);
      await sendPlain(env,chatId,"📝 Додав у ідею.");
      return true;
    }
    // медіа → зберегти на Drive (якщо є токени) і додати лінк у idea.md
    const any = msg?.photo||msg?.document||msg?.video||msg?.audio||msg?.voice||msg?.video_note;
    if(any && tgFileUrl){
      try{
        const url = await tgFileUrl(env, (msg.document||msg.photo?.slice(-1)[0]||msg.video||msg.audio||msg.voice||msg.video_note).file_id);
        let link = url;
        if(getUserTokens && driveSaveFromUrl && await getUserTokens(env,userId)){
          const name = (msg.document?.file_name) || `asset_${Date.now()}`;
          const saved = await driveSaveFromUrl(env,userId,url,name);
          link = saved?.webViewLink || saved?.alternateLink || link;
        }
        await appendSection(env,userId,collectingFor,"idea.md",`\n- Матеріал: ${link}`);
        await sendPlain(env,chatId,"📎 Додав посилання на матеріал у ідею.");
      }catch{
        await sendPlain(env,chatId,"Не вдалося зберегти файл.");
      }
      return true;
    }
  }
  return false;
}

// -------------------- інтенти, код-блоки, файли --------------------
function detectUserIntent(text=""){
  const s=String(text||"").toLowerCase();
  const wantFile=/\b(створи|зроби|create|generate|make)\b/.test(s)||/\b(file|файл)\b/.test(s);
  const wantExtract=/структур|structure|extract structure/.test(s);
  const wantAnalyze=/аналіз|analy(s|z)e|розбір|explain|diagnos/.test(s);
  return { wantFile,wantExtract,wantAnalyze };
}
function extractFirstCodeBlock(md=""){
  const m = md.match(/```([\w+-]*)\s*([\s\S]*?)```/m);
  return m ? { lang:(m[1]||"").toLowerCase(), code:m[2]||"" } : null;
}
function langToExt(lang=""){
  const map={html:"html",js:"js",javascript:"js",ts:"ts",tsx:"tsx",css:"css",json:"json",yaml:"yaml",yml:"yml",py:"py",python:"py",md:"md",markdown:"md",sh:"sh",bash:"sh",zsh:"sh",c:"c",cpp:"cpp",h:"h",hpp:"hpp",java:"java",go:"go",rs:"rs",rust:"rs",php:"php",sql:"sql",kt:"kt",kotlin:"kt",swift:"swift",vue:"vue",svelte:"svelte",jsx:"jsx"};
  return map[lang] || (lang?lang:"txt");
}
function ensureMobileMeta(html){
  if(!/<!doctype html>/i.test(html)) return html;
  if(/name=["']viewport["']/i.test(html)) return html;
  return html.replace(/<head>/i, `<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">`);
}

// -------------------- візійний аналіз --------------------
async function toBase64FromUrl(url){
  const r=await fetch(url); if(!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab=await r.arrayBuffer(); const bytes=new Uint8Array(ab);
  let bin=""; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function analyzeImageForCodex(env,{lang="uk",imageBase64,question}){
  const order="gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";
  const systemHint=`You are Senti Codex. Analyze screenshots/code/logs.\n- Be concise: bullet insights + next steps.\n- If the image is a log/build error, extract exact errors and probable fixes.\n- No HTML. Markdown only.`;
  const userPrompt = question && question.trim()
    ? (lang.startsWith("en")?`User asks: "${question}"`:`Користувач питає: "${question}"`)
    : (lang.startsWith("en")?"Analyze this image for errors, code context and actionable steps.":"Проаналізуй зображення: витягни помилки/контекст коду і дай кроки виправлення.");
  const out = await askVision(env,order,userPrompt,{systemHint,imageBase64,imageMime:"image/png",temperature:0.2});
  if(typeof out==="string") return out;
  if(out?.text) return out.text;
  return JSON.stringify(out);
}

// -------------------- головний генератор Codex --------------------
export async function handleCodexGeneration(env, ctx, helpers){
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64, sendDocument } = helpers;

  // 0) якщо користувач у стані "ввід назви" / "ідея" — обробляємо там
  if(await handleCodexUi(env, chatId, userId, { msg }, helpers)) return;

  // 1) проєктний контекст
  const proj = await buildProjectContext(env,userId);
  const systemBlocks = [
    "You are Senti Codex — precise, practical, no hallucinations.",
    "Answer shortly by default. Prefer Markdown.",
  ];
  if(proj.name) systemBlocks.push(proj.hint);
  const systemHint = systemBlocks.join("\n\n");

  // 2) фото → аналіз
  const ph = pickPhoto ? pickPhoto(msg) : null;
  if(ph?.file_id){
    if(!(await ensureEnergy(env,helpers,userId,chatId,"image"))) return;
    const url = await tgFileUrl(env, ph.file_id);
    const b64 = urlToBase64 ? await urlToBase64(url) : await toBase64FromUrl(url);
    const analysis = await analyzeImageForCodex(env,{lang,imageBase64:b64,question:textRaw||""});
    await sendPlain(env,chatId,analysis);
    if(proj.name){ await appendSection(env,userId,proj.name,"progress.md",`- ${nowIso()} — Аналіз зображення: ${analysis.slice(0,120)}…`); }
    if(sendDocument){ await sendDocument(env,chatId,"codex.analyze.md",analysis,"Ось готовий файл 👇"); }
    return;
  }

  // 3) текст
  if(!(await ensureEnergy(env,helpers,userId,chatId,"text"))) return;
  const order = String(env.MODEL_ORDER||"").trim() || "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";
  const res = await askAnyModel(env,order,textRaw||"Продовжуй",{systemHint,temperature:0.2});
  const outText = typeof res==="string" ? res : (res?.choices?.[0]?.message?.content || res?.text || JSON.stringify(res));
  const intent = detectUserIntent(textRaw||"");

  if(proj.name){ await appendSection(env,userId,proj.name,"progress.md",`- ${nowIso()} — Відповідь Codex: ${(outText||"").slice(0,120)}…`); }
  await sendPlain(env,chatId,outText||"Не впевнений.");

  if(intent.wantFile && sendDocument){
    const block = extractFirstCodeBlock(outText||"");
    let filename="codex.md"; let content=outText||"";
    if(block){
      const ext=langToExt(block.lang);
      filename=`codex.${ext}`; content=block.code;
      if(ext==="html") content=ensureMobileMeta(content);
    }
    await sendDocument(env,chatId,filename,content,"Ось готовий файл 👇");
  }
}

// -------------------- (опціонально) старі текстові команди /project ... --------------------
// Залишено мінімум: list/use/status для сумісності з історією.
// Команди lock/unlock прибрано.
export async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain){
  const txt=String(textRaw||"").trim();
  if(/^\/project\s+list/i.test(txt)){
    const all=await listProjects(env,userId); const cur=await getCurrentProject(env,userId);
    if(!all.length){ await sendPlain(env,chatId,"Немає проєктів. Натисни «New Project»."); return true; }
    await sendPlain(env,chatId,"Оберіть проєкт:",{ reply_markup: projectsKeyboard(all,cur) });
    return true;
  }
  if(/^\/project\s+use\s+/i.test(txt)){
    const name=txt.replace(/^\/project\s+use\s+/i,"").trim();
    const all=await listProjects(env,userId);
    if(!all.includes(name)){ await sendPlain(env,chatId,"Не знайдено."); return true; }
    await setCurrentProject(env,userId,name);
    await sendPlain(env,chatId,`🔸 Активний проєкт: **${name}**`,{ parse_mode:"Markdown" });
    return true;
  }
  if(/^\/project\s+status\b/i.test(txt)){
    return await handleCodexUi(env,chatId,userId,{ cbData:"codex:status" },{ sendPlain });
  }
  return false;
}