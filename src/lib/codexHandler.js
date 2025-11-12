// src/lib/codexHandler.js
// Senti Codex: analyze/fix/code/explain/extract/refactor/design + фото-аналіз.
// Мобільна оптимізація HTML, plain-text для "extract", м'який retry моделей.

// ==== KV keys ===============================================================
const KV = {
  codexMode: (uid) => `codex:mode:${uid}`,
  codexMem:  (uid) => `codex:mem:${uid}`,
  lastPhoto: (uid) => `codex:last-photo:${uid}`,
  lastMode:  (uid) => `codex:last-mode:${uid}`,
};

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV || null;
}
const now = () => Date.now();

// ==== tiny utils ============================================================
function asText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (typeof res.text === "string") return res.text;
  if (Array.isArray(res.choices) && res.choices[0]?.message?.content)
    return res.choices[0].message.content;
  return JSON.stringify(res);
}

function extractCodeAndLang(answer) {
  if (!answer) return { lang: "txt", code: "" };
  const m = answer.match(/```(\w+)?\s*([\s\S]*?)```/m);
  if (m) return { lang: (m[1] || "txt").toLowerCase(), code: m[2].trim() };
  return { lang: "txt", code: String(answer).trim() };
}

function stripMarkdownToText(md) {
  let s = String(md || "");
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/, "").replace(/```$/, "")); // код-блоки → чистий код
  s = s.replace(/^>+\s?/gm, "");                     // цитати
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, "");        // картинки
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");     // посилання
  s = s.replace(/^#{1,6}\s*/gm, "");                 // заголовки
  s = s.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");// жир/курсив
  s = s.replace(/^\s*[-*+]\s+/gm, "- ");             // списки
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function pickFilenameByLangOrMode(mode, lang) {
  const L = String(lang || "").toLowerCase();
  if (mode === "extract") return "codex.extract.txt";           // ⬅ plain text
  if (mode === "fix")     return "codex.fix.md";
  if (mode === "analyze" || mode === "explain" || mode === "design")
    return `codex.${mode}.md`;
  if (L === "html") return "codex.html";
  if (L === "css")  return "codex.css";
  if (L === "js" || L === "javascript") return "codex.js";
  if (L === "json") return "codex.json";
  if (L === "py" || L === "python") return "codex.py";
  if (L === "ts" || L === "typescript") return "codex.ts";
  return "codex.txt";
}

// мобільна обгортка для HTML
function ensureMobileHtml(html) {
  const h = String(html || "");
  const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(h);
  if (hasViewport && /class=["']senti-mobile["']/.test(h)) return h; // вже ок

  const body = h.includes("<body") ? h : `<body>${h}</body>`;
  const headInject = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  :root { color-scheme: dark light; }
  body.senti-mobile { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:#111; color:#eee; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 12px; }
  button, .btn { padding: 12px 16px; font-size: 16px; border-radius: 12px; border:0; background:#2b2b2b; color:#fff; }
  canvas, pre, code { max-width:100%; }
  .grid { display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
  @media (max-width:560px){ .grid { grid-template-columns: 1fr; } }
</style>`.trim();

  const head = `<head>${headInject}</head>`;
  const wrapped =
`<!DOCTYPE html><html lang="uk">
${head}
${body.replace("<body", '<body class="senti-mobile"').replace(/<body[^>]*>/, m => m + '<div class="wrap">').replace("</body>", '</div></body>')}
</html>`;
  return wrapped;
}

// простий 2D тетріс як sanity-тест (залишаємо)
function buildTetrisHtml() {
  return `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Тетріс</title><style>body{background:#111;margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;min-height:100vh;color:#fff}#game{margin:10px;background:#222;padding:10px;border-radius:12px}canvas{background:#000;border:2px solid #444;border-radius:8px}#hud{display:flex;gap:16px;justify-content:center;margin-bottom:8px}.btn{background:#2b2b2b;border:none;color:#fff;padding:12px 16px;border-radius:12px;font-size:16px;margin:2px}</style></head><body><h2>Тетріс</h2><div id="game"><div id="hud">Score: <span id="score">0</span></div><canvas id="board" width="240" height="400"></canvas><div><button class="btn" id="left">◀</button><button class="btn" id="rot">⟳</button><button class="btn" id="right">▶</button><button class="btn" id="down">▼</button><button class="btn" id="drop">⬇</button></div></div><script>const c=document.getElementById('board'),x=c.getContext('2d');const COLS=10,ROWS=20,S=20,CLR=['#000','#0ff','#00f','#f0f','#f90','#0f0','#f00','#ff0'];const SH=[[],[[1,1,1,1]],[[2,0,0],[2,2,2]],[[0,0,3],[3,3,3]],[[4,4],[4,4]],[[0,5,5],[5,5,0]],[[0,6,0],[6,6,6]],[[7,7,0],[0,7,7]]];let B=[],cur,score=0;function reset(){B=[];for(let r=0;r<ROWS;r++){B[r]=[];for(let c=0;c<COLS;c++)B[r][c]=0}}function rnd(){const t=1+Math.floor(Math.random()*(SH.length-1));const s=SH[t];return{x:Math.floor((COLS-s[0].length)/2),y:0,shape:s,type:t}}function col(b,p){for(let r=0;r<p.shape.length;r++)for(let c=0;c<p.shape[r].length;c++)if(p.shape[r][c]){const nr=p.y+r,nc=p.x+c;if(nr<0||nr>=ROWS||nc<0||nc>=COLS||b[nr][nc])return true}return false}function merge(b,p){for(let r=0;r<p.shape.length;r++)for(let c=0;c<p.shape[r].length;c++)if(p.shape[r][c])b[p.y+r][p.x+c]=p.type}function lines(){let L=0;for(let r=ROWS-1;r>=0;r--)if(B[r].every(v=>v)){B.splice(r,1);B.unshift(new Array(COLS).fill(0));L++;r++}if(L){score+=L*100;document.getElementById('score').textContent=score}}function rot(p){const m=p.shape,o=[];for(let c=0;c<m[0].length;c++){const row=[];for(let r=m.length-1;r>=0;r--)row.push(m[r][c]);o.push(row)}return o}function drop(){cur.y++;if(col(B,cur)){cur.y--;merge(B,cur);lines();cur=rnd();if(col(B,cur)){reset();score=0;document.getElementById('score').textContent=0}}}function cell(xi,yi,v){if(!v)return;x.fillStyle=CLR[v];x.fillRect(xi*S,yi*S,S,S);x.strokeStyle='#111';x.strokeRect(xi*S,yi*S,S,S)}function draw(){x.clearRect(0,0,c.width,c.height);for(let r=0;r<ROWS;r++)for(let q=0;q<COLS;q++)cell(q,r,B[r][q]);for(let r=0;r<cur.shape.length;r++)for(let q=0;q<cur.shape[r].length;q++)if(cur.shape[r][q])cell(cur.x+q,cur.y+r,cur.type);requestAnimationFrame(draw)}reset();cur=rnd();draw();addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){cur.x--;if(col(B,cur))cur.x++}if(e.key==='ArrowRight'){cur.x++;if(col(B,cur))cur.x--}if(e.key==='ArrowUp'){const o=cur.shape;cur.shape=rot(cur);if(col(B,cur))cur.shape=o}if(e.key==='ArrowDown')drop()});document.getElementById('left').onclick=()=>{cur.x--;if(col(B,cur))cur.x++};document.getElementById('right').onclick=()=>{cur.x++;if(col(B,cur))cur.x--};document.getElementById('rot').onclick=()=>{const o=cur.shape;cur.shape=rot(cur);if(col(B,cur))cur.shape=o};document.getElementById('down').onclick=drop;document.getElementById('drop').onclick=()=>{while(!col(B,cur))cur.y++;cur.y--;merge(B,cur);lines();cur=rnd()};</script></body></html>`;
}

// простий 3D старт (Three.js) — по команді /tetris3d
function buildTetris3DHtml() {
  const inner = `
  <div class="wrap"><h2>3D Tetris (prototype)</h2><canvas id="c"></canvas></div>
  <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
  <script>
    const canvas=document.getElementById('c'); const renderer=new THREE.WebGLRenderer({canvas, antialias:true});
    function resize(){ const w=Math.min(innerWidth,720); const h= Math.min(innerHeight-40, w*1.2); renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); }
    const scene=new THREE.Scene(); scene.background=new THREE.Color(0x101010);
    const camera=new THREE.PerspectiveCamera(45,1,0.1,100); camera.position.set(6,10,18); camera.lookAt(0,5,0);
    const light=new THREE.DirectionalLight(0xffffff,1); light.position.set(5,10,7); scene.add(light);
    const amb=new THREE.AmbientLight(0x404040); scene.add(amb);
    const grid=new THREE.GridHelper(10,10); grid.position.y=-0.01; scene.add(grid);

    const box=new THREE.BoxGeometry(1,1,1);
    function cube(color,x,y,z){const m=new THREE.MeshPhongMaterial({color}); const c=new THREE.Mesh(box,m); c.position.set(x,y,z); scene.add(c); return c;}
    let pieces=[];
    function spawn(){ const baseY=18; const colors=[0xff5555,0x55ffcc,0xaa66ff,0xffaa00,0x66ff66]; const col=colors[Math.floor(Math.random()*colors.length)];
      const type=Math.floor(Math.random()*5);
      const p=[];
      if(type===0){ for(let i=0;i<4;i++) p.push(cube(col,0,baseY,-i)); } // I
      if(type===1){ p.push(cube(col,0,baseY,0),cube(col,1,baseY,0),cube(col,-1,baseY,0),cube(col,0,baseY,-1)); } // T
      if(type===2){ p.push(cube(col,0,baseY,0),cube(col,1,baseY,0),cube(col,0,baseY,-1),cube(col,1,baseY,-1)); } // O
      if(type===3){ p.push(cube(col,0,baseY,0),cube(col,-1,baseY,0),cube(col,0,baseY,-1),cube(col,1,baseY,-1)); } // S-like
      if(type===4){ p.push(cube(col,0,baseY,0),cube(col,1,baseY,0),cube(col,0,baseY,-1),cube(col,-1,baseY,-1)); } // Z-like
      pieces.push(p);
    }
    const downSpeed=0.04; let acc=0;
    function tick(t){requestAnimationFrame(tick); renderer.render(scene,camera); acc+=downSpeed; if(acc>1){acc=0; for(const p of pieces) for(const c of p) c.position.y-=1; if(pieces.length<5) spawn(); }}
    spawn(); resize(); addEventListener('resize',resize); requestAnimationFrame(tick);
  </script>`;
  return ensureMobileHtml(inner);
}

// ==== external deps ==========================================================
import { askAnyModel } from "./modelRouter.js";
import { describeImage } from "../flows/visionDescribe.js";

// ==== public state API =======================================================
export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env); if (!kv) return;
  await kv.put(KV.codexMode(userId), on ? "on" : "off", { expirationTtl: 60*60*24*180 });
}
export async function getCodexMode(env, userId) {
  const kv = pickKV(env); if (!kv) return false;
  return (await kv.get(KV.codexMode(userId), "text")) === "on";
}
async function loadCodexMem(env, userId) {
  const kv = pickKV(env); if (!kv) return [];
  try { const raw = await kv.get(KV.codexMem(userId), "text"); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
async function saveCodexMem(env, userId, entry) {
  const kv = pickKV(env); if (!kv) return;
  try {
    const arr = await loadCodexMem(env, userId);
    arr.push({ filename: entry.filename, content: entry.content, ts: now() });
    await kv.put(KV.codexMem(userId), JSON.stringify(arr.slice(-50)), { expirationTtl: 60*60*24*180 });
  } catch {}
}
export async function clearCodexMem(env, userId) {
  const kv = pickKV(env); if (!kv) return; try { await kv.delete(KV.codexMem(userId)); } catch {}
}
async function saveLastPhoto(env, userId, photo) {
  const kv = pickKV(env); if (!kv) return;
  try { await kv.put(KV.lastPhoto(userId), JSON.stringify({ ...photo, ts: now() }), { expirationTtl: 60*60*24*7 }); } catch {}
}
async function loadLastPhoto(env, userId) {
  const kv = pickKV(env); if (!kv) return null;
  try { const raw = await kv.get(KV.lastPhoto(userId), "text"); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function saveLastMode(env, userId, mode) {
  const kv = pickKV(env); if (!kv) return; try { await kv.put(KV.lastMode(userId), mode, { expirationTtl: 60*60*24*7 }); } catch {}
}

// ==== intent & mode detection ===============================================
function detectMode(text, hasPhoto) {
  const s = String(text || "").trim().toLowerCase();
  if (/^1$/.test(s)) return "analyze";
  if (/^2$/.test(s)) return "explain";
  if (/^3$/.test(s)) return "extract";
  if (/refactor|рефактор|перероби\s*код/.test(s)) return "refactor";
  if (/design|архітектур|спроєктуй|спроектируй/.test(s)) return "design";
  if (/fix|пофікс|виправ|исправ/i.test(s)) return "fix";
  if (/explain|поясни|объясни/.test(s)) return "explain";
  if (/extract|витягни|вытащи|структур/i.test(s)) return "extract";
  if (/code|зроби\s*код|напиши\s*код|сгенеруй/i.test(s)) return "code";
  if (hasPhoto) return /error|failed|помилк|ошибк|could not|build failed|trace/i.test(s) ? "fix" : "analyze";
  if (/error|failed|could not|trace|stack/i.test(s)) return "fix";
  if (/html|css|js|javascript|py|python|json|yaml|ts|typescript|react/i.test(s)) return "code";
  return "explain";
}

// ==== prompts ===============================================================
function buildSystemHintForMode(mode) {
  const base = `You are Senti Codex — a pragmatic software engineer.
- Prefer minimal, working solutions.
- Return FULL file content; avoid hallucinations. If insufficient data — say "Не впевнений".`;
  const map = {
    analyze: base + `\nTask: Analyze the input (image/log/code) and produce a concise technical report as Markdown.`,
    explain: base + `\nTask: Explain concisely in Markdown with key insights.`,
    extract: base + `\nTask: Extract structured essentials as PLAIN TEXT (no Markdown).`,
    fix:     base + `\nTask: Root-cause analysis + concrete fix steps. Output Markdown with sections.`,
    design:  base + `\nTask: Propose architecture/plan. Output Markdown.`,
    refactor:base + `\nTask: Refactor for clarity/robustness. Return only the full refactored file.`,
    code:    base + `\nTask: Generate a COMPLETE single-file solution; no extra commentary.`,
  };
  return map[mode] || base;
}

function buildUserPrompt({ mode, userText, photoDesc, projectFilesList }) {
  const parts = [];
  if (projectFilesList?.length) parts.push(`[Context files]\n${projectFilesList.map(f => `- ${f}`).join("\n")}`);
  if (photoDesc) parts.push(`[Image description]\n${photoDesc}`);
  if (userText) parts.push(`[User]\n${userText}`);
  if (mode === "fix") {
    parts.push(`Output: Markdown sections -> Summary; Root cause; Fix steps; Patches; Post-checks.`);
  } else if (mode === "extract") {
    parts.push(`Output MUST be plain text (.txt), no Markdown syntax.`);
  } else if (mode === "analyze" || mode === "explain" || mode === "design") {
    parts.push(`Write concise, actionable Markdown. Avoid fluff.`);
  } else if (mode === "code" || mode === "refactor") {
    parts.push(`Return ONLY full code of a single file (no explanations).`);
  }
  return parts.join("\n\n");
}

// ==== model calling with soft retry =========================================
async function callCodexModel(env, text, { systemHint }) {
  let order =
    String(env.CODEX_MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";
  try {
    const res = await askAnyModel(env, order, text, { systemHint, temperature: 0.2 });
    return asText(res);
  } catch {
    // переставимо порядок і спробуємо ще раз
    const alt = "cf:@cf/meta/llama-3.2-11b-instruct, gemini:gemini-2.5-flash, free:meta-llama/llama-4-scout:free";
    const res2 = await askAnyModel(env, alt, text, { systemHint, temperature: 0.2 });
    return asText(res2);
  }
}

// ==== public command handlers ===============================================
export async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  const s = String(textRaw || "").trim();

  if (s === "/clear_last") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) await sendPlain(env, chatId, "Немає файлів для видалення.");
    else {
      arr.pop();
      const kv = pickKV(env); if (kv) await kv.put(KV.codexMem(userId), JSON.stringify(arr));
      await sendPlain(env, chatId, "Останній файл прибрано.");
    }
    return true;
  }

  if (s === "/clear_all") {
    await clearCodexMem(env, userId);
    await sendPlain(env, chatId, "Весь проєкт очищено.");
    return true;
  }

  if (s === "/summary") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) await sendPlain(env, chatId, "У проєкті поки що порожньо.");
    else await sendPlain(env, chatId, `Файли:\n${arr.map(f => `- ${f.filename}`).join("\n")}`);
    return true;
  }

  if (s === "/tetris3d") {
    const html = buildTetris3DHtml();
    const filename = "codex-3d.html";
    const kv = pickKV(env);
    if (kv) await saveCodexMem(env, userId, { filename, content: html });
    await sendPlain(env, chatId, "Генерую 3D тетріс…");
    await sendDocument(env, chatId, filename, html, "Ось готовий файл 👇");
    return true;
  }

  return false;
}

// ==== main generation ========================================================
export async function handleCodexGeneration(env, params, helpers) {
  const { chatId, userId, msg, textRaw, lang, isAdmin } = params;
  const {
    getEnergy, spendEnergy, energyLinks, sendPlain,
    pickPhoto, tgFileUrl, urlToBase64,
    sendDocument, startPuzzleAnimation, editMessageText
  } = helpers;

  // енергія
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 2);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, (lang || "uk").startsWith("uk")
      ? `Не вистачає енергії. Потрібно ${need}. Поповнення: ${links.energy}`
      : `Not enough energy. Need ${need}. Top-up: ${links.energy}`);
    return;
  }

  // індикатор
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  let indicatorId = null;
  if (token) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "🧩 Працюю над завданням…" }),
      });
      const d = await r.json().catch(() => null);
      indicatorId = d?.result?.message_id || null;
    } catch {}
  }

  await spendEnergy(env, userId, need, "codex");

  // фото → опис (тихо, без помилки в чаті)
  let photoDesc = "";
  let hasPhoto = false;
  const photo = pickPhoto(msg);
  if (photo) {
    hasPhoto = true;
    try {
      const imgUrl = await tgFileUrl(env, photo.file_id);
      const imgBase64 = await urlToBase64(imgUrl);
      const vRes = await describeImage(env, {
        chatId,
        tgLang: msg.from?.language_code,
        imageBase64: imgBase64,
        question:
          "Опиши зображення для інженерного аналізу (логи/код/інтерфейс/предмети). Текст OCR додавай лише якщо явно просили.",
        modelOrder: "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
      });
      photoDesc = vRes?.text || "";
      await saveLastPhoto(env, userId, {
        id: photo.file_id, url: imgUrl, caption: msg?.caption || "", desc: photoDesc,
      });
    } catch (e) {
      // тихо логнемо, але не ламаємо пайплайн
      console.warn("Vision error:", e?.message || e);
    }
  } else {
    const last = await loadLastPhoto(env, userId);
    if (last?.desc) photoDesc = last.desc;
  }

  // режим
  const mode = detectMode(textRaw, hasPhoto);
  await saveLastMode(env, userId, mode);

  // спеціальний тригер "тетріс" лишаємо як 2D швидкий демо
  if (/тетріс|tetris/i.test(textRaw || "")) {
    const codeText = buildTetrisHtml();
    const filename = "codex.html";
    await saveCodexMem(env, userId, { filename, content: codeText });
    await sendDocument(env, chatId, filename, codeText, "Ось готовий файл 👇");
    if (indicatorId) await editMessageText(env, chatId, indicatorId, "✅ Готово");
    return;
  }

  // контекст файлів
  const mem = await loadCodexMem(env, userId);
  const filesList = mem.map(f => f.filename);

  // промпти
  const systemHint = buildSystemHintForMode(mode);
  const userPrompt = buildUserPrompt({
    mode, userText: textRaw || "", photoDesc, projectFilesList: filesList
  });

  // анімація
  const animSignal = { done: false };
  if (indicatorId) startPuzzleAnimation(env, chatId, indicatorId, animSignal);

  // генерація
  let answer = await callCodexModel(env, userPrompt, { systemHint });

  // підготовка виходу
  let outText = "";
  let filename = "";

  if (mode === "code" || mode === "refactor") {
    const { lang, code } = extractCodeAndLang(answer);
    outText = code;
    filename = pickFilenameByLangOrMode(mode, lang);
    if (!outText.trim()) {
      const again = await callCodexModel(env, `${userPrompt}\n\nReturn only a single code block.`, { systemHint });
      const e2 = extractCodeAndLang(again);
      outText = e2.code || "/* Не впевнений */";
      filename = pickFilenameByLangOrMode(mode, e2.lang);
    }
    // якщо HTML — мобільна обгортка
    if (filename.endsWith(".html")) outText = ensureMobileHtml(outText);
  } else if (mode === "extract") {
    // plain text
    outText = stripMarkdownToText(answer);
    filename = pickFilenameByLangOrMode(mode, "txt");
  } else {
    // Markdown режими
    outText = String(answer || "").trim() || "Не впевнений.";
    filename = pickFilenameByLangOrMode(mode, "md");
  }

  // зберігаємо та шлемо
  await saveCodexMem(env, userId, { filename, content: outText });
  await sendDocument(env, chatId, filename, outText, "Ось готовий файл 👇");

  // фінал
  if (indicatorId) {
    animSignal.done = true;
    await editMessageText(env, chatId, indicatorId, "✅ Готово");
  }
}