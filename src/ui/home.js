//////////////////////////////
// home.js — Mini-App 2.0 Senti
//////////////////////////////

import { json } from "../lib/utils.js";
import { kvSet, kvGet } from "../lib/kv.js";
import { getProfile } from "../lib/profile.js";
import { getStats } from "../lib/stats.js";
import { getPhotoHistory } from "../lib/photos.js";

const INDEX_HTML = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Senti App</title>
<link rel="stylesheet" href="/app/style.css"/>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
<div id="app">
  <header class="header">
    <div class="logo">Senti</div>
    <div class="subtitle">AI Assistant • Vision • Insights</div>
  </header>

  <nav class="tabs">
    <button class="tab" onclick="openTab('home')">Головна</button>
    <button class="tab" onclick="openTab('profile')">Профіль</button>
    <button class="tab" onclick="openTab('stats')">Статистика</button>
    <button class="tab" onclick="openTab('history')">Історія</button>
  </nav>

  <section id="content" class="content"></section>
</div>

<script src="/app/app.js"></script>
</body>
</html>`;

const STYLE_CSS = `
/* simplified */
body{margin:0;font-family:Arial;background:#fff;}
.header{text-align:center;padding:20px;}
.tabs{display:flex;gap:10px;padding:0 10px;}
.tab{flex:1;padding:10px;background:#2a8bf2;color:#fff;border:none;border-radius:10px;}
.content{padding:20px;}
.card{padding:15px;background:#f5f5f5;border-radius:12px;margin-bottom:15px;}
`;

const APP_JS = `
const tg = window.Telegram.WebApp;
tg.expand();
let uid = tg.initDataUnsafe?.user?.id;

function openTab(tab){
  if(tab==='home') return showHome();
  if(tab==='profile') return loadProfile();
  if(tab==='stats') return loadStats();
  if(tab==='history') return loadHistory();
}

function showHome(){
  document.getElementById('content').innerHTML = \`
    <div class="card">
      <h3>Фото-аналіз</h3>
      <input id="fileInput" type="file" accept="image/*"/>
    </div>\`;
  document.getElementById("fileInput").onchange = async e=>{
    const file = e.target.files[0];
    const fd=new FormData(); fd.append("file",file);
    const r=await fetch("/app/upload",{method:"POST",body:fd});
    const d=await r.json();
    tg.sendData(JSON.stringify({action:"photo_analyze",uid,uploadKey:d.key}));
    document.getElementById('content').innerHTML='Фото відправлено';
  };
}

async function loadProfile(){
  const r=await fetch("/app/profile?uid="+uid);
  const d=await r.json();
  document.getElementById('content').innerHTML=\`
    <div class="card">
      <h3>Профіль</h3>
      ID: \${d.uid}<br/>
      Енергія: \${d.energy}<br/>
      Преміум: \${d.premium?'Так':'Ні'}<br/>
    </div>\`;
}

async function loadStats(){
  const r=await fetch("/app/stats?uid="+uid);
  const d=await r.json();
  document.getElementById('content').innerHTML=\`
    <div class="card">
      <h3>Статистика</h3>
      Повідомлень: \${d.messages}<br/>
      Фото: \${d.photos}<br/>
    </div>\`;
}

async function loadHistory(){
  const r=await fetch("/app/history?uid="+uid);
  const d=await r.json();
  let html='<div class="card"><h3>Історія фото</h3>';
  d.forEach(p=>{html+=\`<img src="data:image/jpeg;base64,\${p.base64}" style="width:100%;border-radius:10px;margin-bottom:10px;"/>\`;});
  html+='</div>';
  document.getElementById('content').innerHTML=html;
}

showHome();
`;

function randomId(){
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
}

export async function serveWebApp(req, env, ctx){
  const url=new URL(req.url);

  if(url.pathname==="/app"||url.pathname==="/app/"){
    return new Response(INDEX_HTML,{headers:{"content-type":"text/html"}});
  }
  if(url.pathname==="/app/style.css"){
    return new Response(STYLE_CSS,{headers:{"content-type":"text/css"}});
  }
  if(url.pathname==="/app/app.js"){
    return new Response(APP_JS,{headers:{"content-type":"text/javascript"}});
  }

  if(url.pathname==="/app/upload"&&req.method==="POST"){
    const form=await req.formData();
    const file=form.get("file");
    const buf=new Uint8Array(await file.arrayBuffer());
    let b=""; for(let i=0;i<buf.length;i++) b+=String.fromCharCode(buf[i]);
    const base64=btoa(b);
    const key="upload:"+randomId();
    await kvSet(env,key,base64);
    return json({ok:true,key});
  }

  if(url.pathname==="/app/profile"){
    const uid=url.searchParams.get("uid");
    const profile=await getProfile(env,uid);
    return json(profile);
  }

  if(url.pathname==="/app/stats"){
    const uid=url.searchParams.get("uid");
    const st=await getStats(env,uid);
    return json(st);
  }

  if(url.pathname==="/app/history"){
    const uid=url.searchParams.get("uid");
    const list=await getPhotoHistory(env,uid);
    return json(list);
  }

  return new Response("Not found",{status:404});
}
