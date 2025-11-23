//////////////////////////////
// home.js — Senti App FINAL 3.0
// Вкладки: Головна / Профіль / Статистика / Історія / Магазин / Premium
//////////////////////////////

import { json } from "../lib/utils.js";
import { kvSet } from "../lib/kv.js";
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
    <div class="subtitle">AI Assistant • Premium • Vision 2.0</div>
  </header>

  <nav class="tabs">
    <button class="tab" onclick="openTab('home')">Головна</button>
    <button class="tab" onclick="openTab('profile')">Профіль</button>
    <button class="tab" onclick="openTab('stats')">Статистика</button>
    <button class="tab" onclick="openTab('history')">Історія</button>
    <button class="tab" onclick="openTab('store')">Магазин</button>
    <button class="tab" onclick="openTab('premium')">Premium</button>
  </nav>

  <section id="content" class="content"></section>

</div>

<script src="/app/app.js"></script>
</body>
</html>`;
const STYLE_CSS = `
body {
  margin:0; padding:0;
  font-family:-apple-system,BlinkMacSystemFont,'Roboto';
  background:var(--tg-theme-bg-color,#fff);
  color:var(--tg-theme-text-color,#111);
}

#app { padding:15px; }

.header { text-align:center; margin-bottom:15px; }
.logo { font-size:32px; font-weight:700; }
.subtitle { color:var(--tg-theme-hint-color,#999); margin-top:4px; }

.tabs {
  display:flex;
  gap:6px;
  margin-bottom:15px;
  overflow-x:auto;
}

.tab {
  flex:1;
  padding:10px;
  border:none;
  border-radius:12px;
  background:var(--tg-theme-button-color,#2a8bf2);
  color:var(--tg-theme-button-text-color,#fff);
  white-space:nowrap;
}

.content { padding:10px; }

.card {
  background:var(--tg-theme-bg-color,#fff);
  border-radius:14px;
  padding:16px;
  margin-bottom:15px;
  box-shadow:0 2px 6px rgba(0,0,0,0.06);
}

.store-btn {
  padding:12px;
  width:100%;
  margin-top:10px;
  background:#2a8bf2;
  border:none;
  color:white;
  border-radius:12px;
  font-size:16px;
}

.img-mini {
  width:100%;
  border-radius:12px;
  margin-bottom:10px;
}
`;
const APP_JS = `
const tg = window.Telegram.WebApp;
tg.expand();
let uid = tg.initDataUnsafe?.user?.id;

function openTab(t){
  if(t==='home') return showHome();
  if(t==='profile') return loadProfile();
  if(t==='stats') return loadStats();
  if(t==='history') return loadHistory();
  if(t==='store') return loadStore();
  if(t==='premium') return loadPremium();
}

function showHome(){
  document.getElementById('content').innerHTML = \`
  <div class="card">
    <h3>Фото-аналіз</h3>
    <input id="fileInput" type="file" accept="image/*" class="store-btn"/>
  </div>\`;
  document.getElementById("fileInput").onchange = uploadPhoto;
}

async function uploadPhoto(e){
  const f=e.target.files[0];
  const fd=new FormData(); fd.append("file",f);
  const r=await fetch("/app/upload",{method:"POST",body:fd});
  const d=await r.json();
  tg.sendData(JSON.stringify({action:"photo_analyze",uid,uploadKey:d.key}));
  document.getElementById("content").innerHTML="Фото відправлено!";
}

async function loadProfile(){
  const r=await fetch("/app/profile?uid="+uid); const d=await r.json();
  document.getElementById('content').innerHTML=\`
  <div class="card">
    <h3>Профіль</h3>
    ID: \${d.uid}<br/>
    Енергія: \${d.energy}<br/>
    Преміум: \${d.premium?"Так":"Ні"}<br/>
  </div>\`;
}

async function loadStats(){
  const r=await fetch("/app/stats?uid="+uid); const d=await r.json();
  document.getElementById('content').innerHTML=\`
  <div class="card">
    <h3>Статистика</h3>
    Повідомлень: \${d.messages}<br/>
    Фото: \${d.photos}<br/>
  </div>\`;
}

async function loadHistory(){
  const r=await fetch("/app/history?uid="+uid); const list=await r.json();
  let html='<div class="card"><h3>Історія фото</h3>';
  list.forEach(p=>{
    html+=\`<img class="img-mini" src="data:image/jpeg;base64,\${p.base64}" />\`;
  });
  html+='</div>';
  document.getElementById('content').innerHTML=html;
}

async function loadStore(){
  document.getElementById('content').innerHTML=\`
  <div class="card">
    <h3>Магазин Senti</h3>
    <button class="store-btn" onclick="buyEnergy(50)">50 енергії — 1$</button>
    <button class="store-btn" onclick="buyEnergy(150)">150 енергії — 2$</button>
    <button class="store-btn" onclick="buyEnergy(500)">500 енергії — 5$</button>
  </div>\`;
}

function buyEnergy(amount){
  tg.sendData(JSON.stringify({action:"buy_energy",uid,amount}));
}

function loadPremium(){
  document.getElementById('content').innerHTML=\`
  <div class="card">
    <h3>Senti Premium</h3>
    <p>Безлімітний Vision • 5× швидше відповіді • Генерації • HD аналіз</p>
    <button class="store-btn" onclick="buyPremium()">Підключити за 3$/міс</button>
  </div>\`;
}

function buyPremium(){
  tg.sendData(JSON.stringify({action:"buy_premium",uid}));
}

showHome();
`;
function randomId() {
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

  if(url.pathname==="/app/upload" && req.method==="POST"){
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
    const p=await getProfile(env,uid);
    return json(p);
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
