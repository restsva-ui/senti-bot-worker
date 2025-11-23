
const tg = window.Telegram.WebApp;
tg.expand(); // повний режим

let uid = tg.initDataUnsafe?.user?.id || null;

function setContent(html) {
  document.getElementById("content").innerHTML = html;
}
/////////////////////////
// Фото-аналіз
/////////////////////////

function openAnalyze() {
  setContent(`
    <div class="card">
      <div class="card-title">Фото-аналіз</div>
      <div class="card-text">Завантаж фото — Senti зробить точний аналіз.</div>
      <input id="fileInput" type="file" accept="image/*" class="upload-btn" />
    </div>
  `);

  document.getElementById("fileInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = await uploadTemp(file);
    sendToBot({
      action: "photo_analyze",
      uid,
      url,
    });

    setContent(`<div class="placeholder">Фото відправлено. Senti аналізує...</div>`);
  };
}

// тимчасове завантаження фото → у твій Worker
async function uploadTemp(file) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/app/upload", {
    method: "POST",
    body: fd,
  });

  const data = await res.json();
  return data.url;
}
/////////////////////////
// Чат режим
/////////////////////////

function openChat() {
  setContent(`
    <div class="card">
      <div class="card-title">Чат з Senti</div>
      <input id="chatInput" class="upload-btn" placeholder="Напиши повідомлення..." />
    </div>
  `);

  document.getElementById("chatInput").onkeydown = (e) => {
    if (e.key === "Enter") {
      tg.sendData(
        JSON.stringify({
          action: "chat_msg",
          uid,
          text: e.target.value,
        })
      );
      e.target.value = "";
    }
  };
}

/////////////////////////
// Реферальна панель
/////////////////////////

function openRef() {
  setContent(`
    <div class="card">
      <div class="card-title">Подарунки за друзів</div>
      <div class="card-text">Запроси друзів і отримуй бонуси у Senti.</div>
      <button class="upload-btn" onclick="sendToBot({action: 'ref_open', uid})">Показати</button>
    </div>
  `);
}

/////////////////////////
// Відправка уWebhook
/////////////////////////

function sendToBot(obj) {
  tg.sendData(JSON.stringify(obj));
}
