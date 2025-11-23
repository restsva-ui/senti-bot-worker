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
