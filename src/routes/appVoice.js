// src/routes/appVoice.js
// Mini App demo: аудіо-реактивний "orb" для voice-візуалу (canvas + mic)

export function handleVoiceApp(req) {
  const url = new URL(req.url);

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Проста health-перевірка для цього ендпоінта (опційно)
  if (url.searchParams.get("ping") === "1") {
    return new Response("ok", { status: 200 });
  }

  const html = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>Senti • Voice</title>

  <!-- Telegram WebApp API (не завадить і поза TG) -->
  <script src="https://telegram.org/js/telegram-web-app.js"></script>

  <style>
    :root{
      --bg:#0b1220; --fg:rgba(255,255,255,.86); --muted:rgba(255,255,255,.65);
      --glass:rgba(255,255,255,.10); --glass2:rgba(255,255,255,.14);
    }
    html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}
    canvas{display:block;width:100%;height:100%}
    .hud{
      position:fixed;left:12px;right:12px;bottom:12px;
      display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;
      padding:12px;border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.06));
      border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(10px)
    }
    .left{display:flex;flex-direction:column;gap:6px;min-width:0}
    .title{font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .status{font-size:12px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}
    .btns{display:flex;gap:8px}
    button{
      appearance:none;border:0;border-radius:14px;padding:10px 12px;
      background:var(--glass2);color:var(--fg);font-weight:800;font-size:13px
    }
    button:active{transform:translateY(1px)}
    button[disabled]{opacity:.55}
  </style>
</head>
<body>
  <canvas id="c"></canvas>

  <div class="hud">
    <div class="left">
      <div class="title" id="appTitle">Senti • Voice</div>
      <div class="status">
        <span id="mode">mode: idle</span>
        <span id="lvl">level: 0.00</span>
      </div>
    </div>
    <div class="btns">
      <button id="micBtn">Mic</button>
      <button id="stopBtn" disabled>Stop</button>
    </div>
  </div>

<script>
(() => {
  // Telegram WebApp init
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();

    const applyTheme = () => {
      const bg = tg.themeParams && tg.themeParams.bg_color;
      const text = tg.themeParams && tg.themeParams.text_color;
      const hint = tg.themeParams && tg.themeParams.hint_color;
      if (bg) document.documentElement.style.setProperty('--bg', bg);
      if (text) document.documentElement.style.setProperty('--fg', text);
      if (hint) document.documentElement.style.setProperty('--muted', hint);
    };
    applyTheme();
    tg.onEvent('themeChanged', applyTheme);
  }

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const modeEl = document.getElementById('mode');
  const lvlEl = document.getElementById('lvl');
  const micBtn = document.getElementById('micBtn');
  const stopBtn = document.getElementById('stopBtn');

  function resize(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  addEventListener('resize', resize); resize();

  let audioCtx=null, analyser=null, data=null, micStream=null;
  let smoothed=0, phase=0;
  let mode='idle';

  const setMode = (m)=>{ mode=m; modeEl.textContent='mode: '+m; };

  function computeMicLevel(){
    if(!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum=0;
    for(let i=0;i<data.length;i++){
      const v=(data[i]-128)/128;
      sum += v*v;
    }
    const rms=Math.sqrt(sum/data.length);
    return Math.min(1, rms*2.2);
  }

  async function startMic(){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    micStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    data = new Uint8Array(analyser.fftSize);
    src.connect(analyser);
    setMode('listening');
  }

  function stopAll(){
    try{ micStream && micStream.getTracks && micStream.getTracks().forEach(t=>t.stop()); }catch{}
    micStream=null; analyser=null; data=null;
    if(audioCtx){ try{ audioCtx.close(); }catch{} }
    audioCtx=null;
    setMode('idle');
  }

  function draw(){
    const w=innerWidth, h=innerHeight;
    ctx.clearRect(0,0,w,h);

    const bg = ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*0.75);
    bg.addColorStop(0,'rgba(40,120,255,0.10)');
    bg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,w,h);

    const raw = computeMicLevel();
    smoothed += (raw - smoothed)*0.12;
    phase += 0.02;

    if (analyser) {
      if (smoothed > 0.10) setMode('speaking');
      else setMode('listening');
    }

    const baseR = Math.min(w,h)*0.12;
    const breathe = Math.sin(phase)*baseR*0.04;
    const pulse = baseR*(0.20 + smoothed*1.25);
    const R = baseR + pulse + breathe;

    const core = ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,R);
    core.addColorStop(0, 'rgba(120,220,255,' + (0.62 + smoothed*0.28) + ')');
    core.addColorStop(0.55, 'rgba(40,140,255,' + (0.18 + smoothed*0.22) + ')');
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(w/2,h/2,R,0,Math.PI*2); ctx.fill();

    for(let i=1;i<=6;i++){
      const rr = R + i*baseR*0.33 + smoothed*baseR*i*0.25;
      const a = 0.08 + smoothed*0.18;
      ctx.strokeStyle = 'rgba(160,235,255,' + a + ')';
      ctx.lineWidth = 1 + smoothed*2;
      ctx.beginPath(); ctx.arc(w/2,h/2,rr,0,Math.PI*2); ctx.stroke();
    }

    const pCount = 90;
    for(let i=0;i<pCount;i++){
      const a = (i/pCount)*Math.PI*2 + phase*0.35;
      const rr = R + baseR*0.85 + (i%9)*baseR*0.10 + smoothed*baseR*0.6;
      const x = w/2 + Math.cos(a)*rr;
      const y = h/2 + Math.sin(a)*rr;
      const alpha = 0.07 + smoothed*0.20;
      ctx.fillStyle = 'rgba(200,245,255,' + alpha + ')';
      ctx.fillRect(x,y,2,2);
    }

    lvlEl.textContent = 'level: ' + smoothed.toFixed(2);
    requestAnimationFrame(draw);
  }
  draw();

  micBtn.onclick = async ()=>{
    micBtn.disabled = true;
    try{
      await startMic();
      stopBtn.disabled = false;
      micBtn.textContent = 'Mic ON';
    }catch(e){
      micBtn.disabled = false;
      micBtn.textContent = 'Mic';
      setMode('idle');
      alert('Нема доступу до мікрофона. Перевір дозвіл (Telegram/браузер).');
      console.error(e);
    }
  };

  stopBtn.onclick = ()=>{
    stopAll();
    stopBtn.disabled = true;
    micBtn.disabled = false;
    micBtn.textContent = 'Mic';
  };
})();
</script>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}