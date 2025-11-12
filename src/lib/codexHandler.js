// src/lib/codexHandler.js
// Senti Codex: режимний інженер (analyze/fix/code/explain/extract/refactor/design)
// — працює з текстом і зображеннями, з KV-пам'яттю, повертає повні файли.

// ==== KV keys ===============================================================
const KV = {
  codexMode: (uid) => `codex:mode:${uid}`,          // "on" | "off"
  codexMem:  (uid) => `codex:mem:${uid}`,           // [{filename, content, ts}]
  lastPhoto: (uid) => `codex:last-photo:${uid}`,    // { id, url, caption, desc, ts }
  lastMode:  (uid) => `codex:last-mode:${uid}`,     // string
};

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV || null;
}

// ==== tiny utils ============================================================
function now() { return Date.now(); }

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
  // найперше — спробуємо код-блок
  const m = answer.match(/```(\w+)?\s*([\s\S]*?)```/m);
  if (m) return { lang: (m[1] || "txt").toLowerCase(), code: m[2].trim() };
  // fallback — повертаємо як текст
  return { lang: "txt", code: String(answer).trim() };
}

function pickFilenameByLangOrMode(mode, lang) {
  const L = String(lang || "").toLowerCase();
  if (mode === "fix") return "codex.fix.md";
  if (mode === "analyze" || mode === "explain" || mode === "extract" || mode === "design") {
    return `codex.${mode}.md`;
  }
  if (L === "html") return "codex.html";
  if (L === "css")  return "codex.css";
  if (L === "js" || L === "javascript") return "codex.js";
  if (L === "json") return "codex.json";
  if (L === "py" || L === "python") return "codex.py";
  if (L === "ts" || L === "typescript") return "codex.ts";
  return "codex.txt";
}

// дуже маленький готовий тетріс (залишаємо як easter-egg/тест)
function buildTetrisHtml() {
  return `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тетріс</title><style>body{background:#111;margin:0;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;color:#fff}#game{margin:10px;background:#222;padding:10px;border-radius:10px}canvas{background:#000;border:2px solid #444;border-radius:6px}#hud{display:flex;gap:16px;justify-content:center;margin-bottom:8px}.btn{background:#555;border:none;color:#fff;padding:8px 14px;border-radius:6px;font-size:16px;margin:2px}</style></head><body><h2>Тетріс</h2><div id="game"><div id="hud">Score: <span id="score">0</span></div><canvas id="board" width="240" height="400"></canvas><div><button class="btn" id="left">◀</button><button class="btn" id="rot">⟳</button><button class="btn" id="right">▶</button><button class="btn" id="down">▼</button><button class="btn" id="drop">⬇</button></div></div><script>const c=document.getElementById('board'),x=c.getContext('2d');const COLS=10,ROWS=20,S=20,CLR=['#000','#0ff','#00f','#f0f','#f90','#0f0','#f00','#ff0'];const SH=[[],[[1,1,1,1]],[[2,0,0],[2,2,2]],[[0,0,3],[3,3,3]],[[4,4],[4,4]],[[0,5,5],[5,5,0]],[[0,6,0],[6,6,6]],[[7,7,0],[0,7,7]]];let B=[],cur,score=0;function reset(){B=[];for(let r=0;r<ROWS;r++){B[r]=[];for(let c=0;c<COLS;c++)B[r][c]=0}}function rnd(){const t=1+Math.floor(Math.random()*(SH.length-1));const s=SH[t];return{x:Math.floor((COLS-s[0].length)/2),y:0,shape:s,type:t}}function col(b,p){for(let r=0;r<p.shape.length;r++)for(let c=0;c<p.shape[r].length;c++)if(p.shape[r][c]){const nr=p.y+r,nc=p.x+c;if(nr<0||nr>=ROWS||nc<0||nc>=COLS||b[nr][nc])return true}return false}function merge(b,p){for(let r=0;r<p.shape.length;r++)for(let c=0;c<p.shape[r].length;c++)if(p.shape[r][c])b[p.y+r][p.x+c]=p.type}function lines(){let L=0;for(let r=ROWS-1;r>=0;r--)if(B[r].every(v=>v)){B.splice(r,1);B.unshift(new Array(COLS).fill(0));L++;r++}if(L){score+=L*100;document.getElementById('score').textContent=score}}function rot(p){const m=p.shape,o=[];for(let c=0;c<m[0].length;c++){const row=[];for(let r=m.length-1;r>=0;r--)row.push(m[r][c]);o.push(row)}return o}function drop(){cur.y++;if(col(B,cur)){cur.y--;merge(B,cur);lines();cur=rnd();if(col(B,cur)){reset();score=0;document.getElementById('score').textContent=0}}}function cell(xi,yi,v){if(!v)return;x.fillStyle=CLR[v];x.fillRect(xi*S,yi*S,S,S);x.strokeStyle='#111';x.strokeRect(xi*S,yi*S,S,S)}function draw(){x.clearRect(0,0,c.width,c.height);for(let r=0;r<ROWS;r++)for(let q=0;q<COLS;q++)cell(q,r,B[r][q]);for(let r=0;r<cur.shape.length;r++)for(let q=0;q<cur.shape[r].length;q++)if(cur.shape[r][q])cell(cur.x+q,cur.y+r,cur.type);requestAnimationFrame(draw)}reset();cur=rnd();draw();document.getElementById('left').onclick=()=>{cur.x--;if(col(B,cur))cur.x++};document.getElementById('right').onclick=()=>{cur.x++;if(col(B,cur))cur.x--};document.getElementById('rot').onclick=()=>{const o=cur.shape;cur.shape=rot(cur);if(col(B,cur))cur.shape=o};document.getElementById('down').onclick=drop;document.getElementById('drop').onclick=()=>{while(!col(B,cur))cur.y++;cur.y--;merge(B,cur);lines();cur=rnd()};</script></body></html>`;
}

// ==== external deps ==========================================================
import { askAnyModel } from "./modelRouter.js";
import { describeImage } from "../flows/visionDescribe.js";

// ==== public state API =======================================================
export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env); if (!kv) return;
  await kv.put(KV.codexMode(userId), on ? "on" : "off", { expirationTtl: 60 * 60 * 24 * 180 });
}
export async function getCodexMode(env, userId) {
  const kv = pickKV(env); if (!kv) return false;
  const v = await kv.get(KV.codexMode(userId), "text");
  return v === "on";
}

async function loadCodexMem(env, userId) {
  const kv = pickKV(env); if (!kv) return [];
  try {
    const raw = await kv.get(KV.codexMem(userId), "text");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveCodexMem(env, userId, entry) {
  const kv = pickKV(env); if (!kv) return;
  try {
    const arr = await loadCodexMem(env, userId);
    arr.push({ filename: entry.filename, content: entry.content, ts: now() });
    await kv.put(KV.codexMem(userId), JSON.stringify(arr.slice(-50)), {
      expirationTtl: 60 * 60 * 24 * 180,
    });
  } catch {}
}
export async function clearCodexMem(env, userId) {
  const kv = pickKV(env); if (!kv) return;
  try { await kv.delete(KV.codexMem(userId)); } catch {}
}

// зберегти аналіз останнього фото (щоб можна було дати “2/3” наступним меседжем)
async function saveLastPhoto(env, userId, photo) {
  const kv = pickKV(env); if (!kv) return;
  try { await kv.put(KV.lastPhoto(userId), JSON.stringify({ ...photo, ts: now() }), { expirationTtl: 60 * 60 * 24 * 7 }); } catch {}
}
async function loadLastPhoto(env, userId) {
  const kv = pickKV(env); if (!kv) return null;
  try { const raw = await kv.get(KV.lastPhoto(userId), "text"); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function saveLastMode(env, userId, mode) {
  const kv = pickKV(env); if (!kv) return;
  try { await kv.put(KV.lastMode(userId), mode, { expirationTtl: 60 * 60 * 24 * 7 }); } catch {}
}

// ==== intent & mode detection ===============================================
// Підтримує короткі варіанти: "1/2/3", "analyze/explain/extract", "поясни", "витягни", "зроби код", "refactor", "fix", …
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

  // якщо фото без команди — за замовчуванням "analyze", але якщо у підписі є "помилка"
  if (hasPhoto) {
    if (/error|failed|помилк|ошибк|could not|build failed|trace/i.test(s)) return "fix";
    return "analyze";
  }

  // за замовчуванням для тексту: якщо є "error/failed" → fix, інакше code|explain
  if (/error|failed|could not|trace|stack/i.test(s)) return "fix";
  if (/html|css|js|javascript|py|python|json|yaml|ts|typescript|react/i.test(s)) return "code";

  return "explain";
}

// ==== prompts ================================================================
function buildSystemHintForMode(mode) {
  const base = `You are Senti Codex — a pragmatic software engineer.
- Prefer minimal, working solutions.
- Return FULL file content without explanations unless the mode requires prose.
- Be consistent, avoid hallucinations; say "Не впевнений" / "Not sure" if data is insufficient.`;

  const map = {
    analyze: base + `\nTask: Analyze provided input (image/log/code) and produce a concise technical report as Markdown.`,
    explain: base + `\nTask: Explain the content in concise Markdown with bullet points and key insights.`,
    extract: base + `\nTask: Extract structured information (file tree, errors, requirements, configs) as Markdown.`,
    fix:     base + `\nTask: Diagnose root-cause and propose specific fixes. Output a Markdown file with titled sections and code patches where useful.`,
    design:  base + `\nTask: Propose an architecture/plan with steps and tradeoffs. Output Markdown.`,
    refactor: base + `\nTask: Refactor code for clarity and robustness. Return ONLY the full refactored file.`,
    code:    base + `\nTask: Generate a COMPLETE single-file solution; no extra commentary.`,
  };
  return map[mode] || base;
}

function buildUserPrompt({ mode, userText, photoDesc, projectFilesList }) {
  const parts = [];
  if (projectFilesList?.length) {
    parts.push(`[Context files]\n${projectFilesList.map(f => `- ${f}`).join("\n")}`);
  }
  if (photoDesc) {
    parts.push(`[Image description]\n${photoDesc}`);
  }
  if (userText) {
    parts.push(`[User]\n${userText}`);
  }

  // мінімальні специфічні інструкції за режимом
  if (mode === "fix") {
    parts.push(`Output format: Markdown with sections:
- Summary
- Root cause
- Fix steps
- Patches (if any)
- Post-checks`);
  } else if (mode === "extract") {
    parts.push(`Extract only the essential structured data. Use headings and lists.`);
  } else if (mode === "analyze" || mode === "explain" || mode === "design") {
    parts.push(`Write concise, actionable Markdown. Avoid fluff.`);
  } else if (mode === "code" || mode === "refactor") {
    parts.push(`Return ONLY the full code (one file) with no explanations.`);
  }

  return parts.join("\n\n");
}

// ==== model calling ==========================================================
async function callCodexModel(env, text, { systemHint }) {
  const order =
    String(env.CODEX_MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";
  const res = await askAnyModel(env, order, text, { systemHint, temperature: 0.2 });
  return asText(res);
}
// ==== public command handlers ===============================================

/**
 * Обробка службових команд у Codex-режимі.
 * Повертає true, якщо команда оброблена (webhook має завершити гілку).
 */
export async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  const s = String(textRaw || "").trim();

  if (s === "/clear_last") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) {
      await sendPlain(env, chatId, "Немає файлів для видалення.");
    } else {
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

/**
 * Головна генерація Codex (викликається з webhook).
 * helpers: об'єкт із функціями телеграма/енергії/утиліт, переданих із webhook.
 */
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

  // знімемо опис із фото (якщо є) або використаємо кеш
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
          "Опиши це зображення для інженерного аналізу (логи/код/інтерфейс/предмети). Якщо текст явно не просили — не додавай розділ OCR.",
        modelOrder: "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
      });
      photoDesc = vRes?.text || "";
      await saveLastPhoto(env, userId, {
        id: photo.file_id, url: imgUrl, caption: msg?.caption || "", desc: photoDesc,
      });
    } catch (e) {
      if (isAdmin) {
        await sendPlain(env, chatId, `❌ Vision error: ${String(e.message || e).slice(0, 160)}`);
      }
    }
  } else {
    const last = await loadLastPhoto(env, userId);
    if (last?.desc) photoDesc = last.desc;
  }

  // визначимо режим
  const mode = detectMode(textRaw, hasPhoto);
  await saveLastMode(env, userId, mode);

  // спец-кейс: “тетріс”
  if (/тетріс|tetris/i.test(textRaw || "")) {
    const codeText = buildTetrisHtml();
    const filename = "codex.html";
    await saveCodexMem(env, userId, { filename, content: codeText });
    await sendDocument(env, chatId, filename, codeText, "Ось готовий файл 👇");
    if (indicatorId) {
      await editMessageText(env, chatId, indicatorId, "✅ Готово");
    }
    return;
  }

  // список файлів у контексті (імена з KV пам'яті)
  const mem = await loadCodexMem(env, userId);
  const filesList = mem.map((f) => f.filename);

  // промпти
  const systemHint = buildSystemHintForMode(mode);
  const userPrompt = buildUserPrompt({
    mode, userText: textRaw || "", photoDesc, projectFilesList: filesList
  });

  // анімація-луп
  const animSignal = { done: false };
  if (indicatorId) startPuzzleAnimation(env, chatId, indicatorId, animSignal);

  // виклик моделей
  let answer = await callCodexModel(env, userPrompt, { systemHint });

  // після-віджет: якщо режим code/refactor — витягнути код-блок
  let outText = "";
  let filename = "";
  if (mode === "code" || mode === "refactor") {
    const { lang, code } = extractCodeAndLang(answer);
    outText = code;
    filename = pickFilenameByLangOrMode(mode, lang);
    // якщо модель не дала коду — спробуємо ще раз із прямою інструкцією
    if (!outText.trim()) {
      const again = await callCodexModel(env,
        `${userPrompt}\n\nReturn only a single code block.`,
        { systemHint });
      const e2 = extractCodeAndLang(again);
      outText = e2.code || "/* Не впевнений */";
      filename = pickFilenameByLangOrMode(mode, e2.lang);
    }
  } else {
    // інші режими — Markdown/текст
    outText = String(answer || "").trim() || "Не впевнений.";
    filename = pickFilenameByLangOrMode(mode, "md");
  }

  // зберегти пам'ять і відправити файл
  await saveCodexMem(env, userId, { filename, content: outText });
  await sendDocument(env, chatId, filename, outText, "Ось готовий файл 👇");

  // фініш індикатора
  if (indicatorId) {
    animSignal.done = true;
    await editMessageText(env, chatId, indicatorId, "✅ Готово");
  }
}