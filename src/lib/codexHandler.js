// src/lib/codexHandler.js
// Винесений Codex з webhook.js

import { askAnyModel } from "./modelRouter.js";

// --- KV keys ---
const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;

// ---- codex project memory
async function loadCodexMem(env, userId) {
  try {
    const raw = await (env.STATE_KV || env.CHECKLIST_KV)?.get(
      CODEX_MEM_KEY(userId),
      "text"
    );
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveCodexMem(env, userId, entry) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const arr = await loadCodexMem(env, userId);
    arr.push({
      filename: entry.filename,
      content: entry.content,
      ts: Date.now(),
    });
    await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr.slice(-50)), {
      expirationTtl: 60 * 60 * 24 * 180,
    });
  } catch {}
}

async function clearCodexMem(env, userId) {
  try {
    const kv = env.STATE_KV || env.CHECKLIST_KV;
    if (kv) await kv.delete(CODEX_MEM_KEY(userId));
  } catch {}
}

// ---- codex mode state
async function setCodexMode(env, userId, on) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(CODEX_MODE_KEY(userId), on ? "on" : "off", {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}

async function getCodexMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  const val = await kv.get(CODEX_MODE_KEY(userId), "text");
  return val === "on";
}

// ---- call model for code
function asText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (typeof res.text === "string") return res.text;
  if (Array.isArray(res.choices) && res.choices[0]?.message?.content)
    return res.choices[0].message.content;
  return JSON.stringify(res);
}

async function runCodex(env, userText) {
  const order =
    String(env.CODEX_MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";
  const sys = `You are Senti Codex.
Return ONLY code (full file) with no explanations.`;
  const res = await askAnyModel(env, order, userText, { systemHint: sys });
  return asText(res);
}

function extractCodeAndLang(answer) {
  if (!answer) return { lang: "txt", code: "" };
  const m = answer.match(/```(\w+)?\s*([\s\S]*?)```/m);
  if (m) {
    return { lang: m[1] || "txt", code: m[2].trim() };
  }
  return { lang: "txt", code: answer.trim() };
}

function pickFilenameByLang(lang) {
  const l = (lang || "").toLowerCase();
  if (l === "html") return "codex.html";
  if (l === "css") return "codex.css";
  if (l === "js" || l === "javascript") return "codex.js";
  if (l === "json") return "codex.json";
  if (l === "py" || l === "python") return "codex.py";
  return "codex.txt";
}

// готовий мобільний тетріс
function buildTetrisHtml() {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Тетріс</title>
<style>
body{background:#111;margin:0;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-height:100vh;color:#fff}
#game-container{margin-top:10px;background:#222;padding:10px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.4)}
#hud{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
canvas{background:#000;border:2px solid #444;border-radius:6px}
#controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;justify-content:center}
.btn{background:#555;border:none;color:#fff;padding:8px 14px;border-radius:6px;font-size:16px}
.btn:active{transform:scale(.96)}
@media(max-width:600px){
  canvas{width:300px;height:500px}
}
</style>
</head>
<body>
<h2>Тетріс</h2>
<div id="game-container">
  <div id="hud">
    <div>Score: <span id="score">0</span></div>
    <div>Level: <span id="level">1</span></div>
  </div>
  <canvas id="board" width="240" height="400"></canvas>
  <div id="controls">
    <button class="btn" id="left">◀</button>
    <button class="btn" id="rotate">⟳</button>
    <button class="btn" id="right">▶</button>
    <button class="btn" id="down">▼</button>
    <button class="btn" id="drop">⬇</button>
  </div>
</div>
<script>
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const COLS=10, ROWS=20, BLOCK=20;
const COLORS=['#000','#0ff','#00f','#f0f','#f90','#0f0','#f00','#ff0'];
const SHAPES=[[],[[1,1,1,1]],[[2,0,0],[2,2,2]],[[0,0,3],[3,3,3]],[[4,4],[4,4]],[[0,5,5],[5,5,0]],[[0,6,0],[6,6,6]],[[7,7,0],[0,7,7]]];
let board=[], current, score=0;
function resetBoard(){board=[];for(let r=0;r<ROWS;r++){board[r]=[];for(let c=0;c<COLS;c++)board[r][c]=0;}}
function randomPiece(){const t=1+Math.floor(Math.random()*(SHAPES.length-1));const shape=SHAPES[t];return{x:Math.floor((COLS-shape[0].length)/2),y:0,shape:shape,type:t};}
function collide(b,p){for(let r=0;r<p.shape.length;r++){for(let c=0;c<p.shape[r].length;c++){if(p.shape[r][c]!==0){const nr=p.y+r,nc=p.x+c;if(nr<0||nr>=ROWS||nc<0||nc>=COLS||b[nr][nc]!==0){return true;}}}}return false;}
function merge(b,p){for(let r=0;r<p.shape.length;r++){for(let c=0;c<p.shape[r].length;c++){if(p.shape[r][c]!==0){b[p.y+r][p.x+c]=p.type;}}}}
function clearLines(){let lines=0;for(let r=ROWS-1;r>=0;r--){if(board[r].every(v=>v!==0)){board.splice(r,1);board.unshift(new Array(COLS).fill(0));lines++;r++;}}if(lines>0){score+=lines*100;document.getElementById('score').textContent=score;}}
function rotate(p){const m=p.shape;const rotated=[];for(let c=0;c<m[0].length;c++){const row=[];for(let r=m.length-1;r>=0;r--){row.push(m[r][c]);}rotated.push(row);}return rotated;}
function drop(){current.y++;if(collide(board,current)){current.y--;merge(board,current);clearLines();current=randomPiece();if(collide(board,current)){resetBoard();score=0;document.getElementById('score').textContent=0;}}}
function drawCell(x,y,v){if(v===0)return;ctx.fillStyle=COLORS[v];ctx.fillRect(x*BLOCK,y*BLOCK,BLOCK,BLOCK);ctx.strokeStyle="#111";ctx.strokeRect(x*BLOCK,y*BLOCK,BLOCK,BLOCK);}
function drawBoard(){ctx.clearRect(0,0,canvas.width,canvas.height);for(let r=0;r<ROWS;r++){for(let c=0;c<COLS;c++){drawCell(c,r,board[r][c]);}}for(let r=0;r<current.shape.length;r++){for(let c=0;c<current.shape[r].length;c++){if(current.shape[r][c]!==0){drawCell(current.x+c,current.y+r,current.type);}}}}
function update(time=0){drawBoard();requestAnimationFrame(update);}
resetBoard();current=randomPiece();update();
document.getElementById('left').onclick=function(){current.x--;if(collide(board,current))current.x++;};
document.getElementById('right').onclick=function(){current.x++;if(collide(board,current))current.x--;};
document.getElementById('rotate').onclick=function(){const old=current.shape;current.shape=rotate(current);if(collide(board,current))current.shape=old;};
document.getElementById('down').onclick=function(){drop();};
document.getElementById('drop').onclick=function(){while(!collide(board,current)){current.y++;}current.y--;merge(board,current);clearLines();current=randomPiece();};
</script>
</body>
</html>`;
}

// --- admin-style команди всередині codex mode ---
async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  if (textRaw === "/clear_last") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) {
      await sendPlain(env, chatId, "Немає файлів для видалення.");
    } else {
      arr.pop();
      const kv = env.STATE_KV || env.CHECKLIST_KV;
      if (kv) await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr));
      await sendPlain(env, chatId, "Останній файл прибрано.");
    }
    return true;
  }
  if (textRaw === "/clear_all") {
    await clearCodexMem(env, userId);
    await sendPlain(env, chatId, "Весь проєкт очищено.");
    return true;
  }
  if (textRaw === "/summary") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) {
      await sendPlain(env, chatId, "У проєкті поки що порожньо.");
    } else {
      const lines = arr.map((f) => `- ${f.filename}`).join("\n");
      await sendPlain(env, chatId, `Файли:\n${lines}`);
    }
    return true;
  }
  return false;
}

// --- main codex handler (generate file) ---
async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const {
    getEnergy,
    spendEnergy,
    energyLinks,
    sendPlain,
    pickPhoto,
    tgFileUrl,
    urlToBase64,
    describeImage, // може бути undefined
    sendDocument,
    startPuzzleAnimation,
    editMessageText,
  } = helpers;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 2);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      (lang && lang.startsWith("uk"))
        ? `Потрібно енергії: ${need}. Отримати: ${links.energy}`
        : `Need energy: ${need}. Get: ${links.energy}`
    );
    return true;
  }

  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  let indicatorId = null;
  if (token) {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🧩 Працюю над кодом…",
        }),
      }
    );
    const d = await r.json().catch(() => null);
    indicatorId = d?.result?.message_id || null;
  }

  await spendEnergy(env, userId, need, "codex");

  let userPrompt = textRaw || "";

  // якщо є фото і є describeImage у хелперах — додаємо опис у промпт
  const photoInCodex = pickPhoto ? pickPhoto(msg) : null;
  if (photoInCodex && describeImage) {
    try {
      const imgUrl = await tgFileUrl(env, photoInCodex.file_id);
      const imgBase64 = await urlToBase64(imgUrl);
      const vRes = await describeImage(env, {
        chatId,
        tgLang: msg.from?.language_code,
        imageBase64: imgBase64,
        question:
          "Опиши це зображення так, щоб за описом можна було написати HTML/JS/CSS проєкт.",
        modelOrder:
          "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
      });
      const imgDesc = vRes?.text || "";
      userPrompt =
        (userPrompt ? userPrompt + "\n\n" : "") +
        "Ось опис зображення користувача, використай його в коді:\n" +
        imgDesc;
    } catch {
      // тихо ідемо далі
    }
  }

  const animSignal = { done: false };
  if (indicatorId) {
    startPuzzleAnimation(env, chatId, indicatorId, animSignal);
  }

  let codeText;
  if (/тетріс|tetris/i.test(userPrompt)) {
    codeText = buildTetrisHtml();
  } else {
    const ans = await runCodex(env, userPrompt);
    const { code } = extractCodeAndLang(ans);
    codeText = code;
  }

  const filename = "codex.html";
  await saveCodexMem(env, userId, { filename, content: codeText });
  await sendDocument(env, chatId, filename, codeText, "Ось готовий файл 👇");

  if (indicatorId) {
    animSignal.done = true;
    await editMessageText(env, chatId, indicatorId, "✅ Готово");
  }

  return true;
}

export {
  CODEX_MEM_KEY,
  setCodexMode,
  getCodexMode,
  clearCodexMem,
  handleCodexCommand,
  handleCodexGeneration,
  buildTetrisHtml,
};
