🔥 Готово!
Оновив чек-лист з урахуванням виправлень у src/index.js (тепер він ігнорує callback_query, щоб не плодити "✅ Отримав оновлення").

Ось файл docs/checklist.md цілком, щоб ти міг копі-паст одним натиском:

# ✅ Чек-лист проєкту Senti Bot Worker

Цей документ фіксує актуальний стан коду, структури та секретів.  
Використовувати **завжди**, коли треба правити код або додавати нові файли,  
щоб не ламати існуючу логіку.

---

## 📂 Структура репозиторію

/src ├── index.js        ← головний вхід (webhook, базова логіка, делегування у router.js) ├── router.js       ← маршрутизація нових команд та кнопок (/menu, /likepanel, /stats) ├── lib/ │     └── tg.js     ← універсальні Telegram API-хелпери └── commands/ ├── menu.js   ← побудова меню (/menu) ├── likes.js  ← панель лайків + callback └── stats.js  ← статистика wrangler.toml         ← конфіг Cloudflare Worker .github/workflows/ └── deploy.yml      ← GitHub Actions деплой /docs └── checklist.md    ← цей файл

---

## 🔑 Секрети та змінні оточення

### GitHub Secrets
- `CLOUDFLARE_API_TOKEN` – токен доступу до API
- `CF_ACCOUNT_ID` – ідентифікатор акаунту Cloudflare
- `BOT_TOKEN` – токен Telegram бота

### Cloudflare Worker Vars
- `BOT_TOKEN` (той самий токен бота)
- `WEBHOOK_SECRET` = `senti1984`
- `API_BASE_URL` = `https://api.telegram.org`

### Cloudflare Worker KV
- Binding: `STATE`
- Namespace ID: `7b32e2d1f60846ddb1c653eb52180bf7`

---

## ⚙️ Основна логіка

- `index.js`
  - `/start` → привітання
  - `/ping` → `pong ✅`
  - `/kvset <key> <value>` → зберігає у KV
  - `/kvget <key>` → читає з KV
  - echo → повторює будь-який текст
  - фото/документ → підтвердження  
  - ⚠️ **НЕ обробляє `callback_query`** (це робить `router.js`)

- `router.js`
  - `/menu` → меню з кнопками
  - `/likepanel` → панель лайків 👍👎
  - `/stats` → зводить статистику
  - обробка callback-кнопок:
    - `cmd:likepanel` → створити панель
    - `cmd:stats` → показати статистику
    - `like` / `dislike` → рахунок у KV + редагування повідомлення

- `lib/tg.js`
  - `tg(env, method, body)` – базовий виклик Bot API
  - Обгортки: `sendMessage`, `answerCallbackQuery`, `editMessageText`, `sendPhoto`, `sendDocument`

- `commands/`
  - `menu.js` – просте меню
  - `likes.js` – панель лайків (альтернативна реалізація, зараз не використовується напряму)
  - `stats.js` – вивід статистики (альтернативна реалізація, зараз не використовується напряму)

---

## 📦 Деплой

1. Автоматично через GitHub Actions → `.github/workflows/deploy.yml`
   - використовує `wrangler@3`
   - деплой за допомогою `wrangler deploy --config wrangler.toml`

2. Ручний деплой:
   ```bash
   wrangler deploy --config wrangler.toml --log-level debug


---

📝 Оновлення 2025-09-25

src/index.js:

додано перевірку if (update.callback_query) return; у handleBasic,
щоб fallback не відповідав на натискання кнопок.


Перевірено роботу: /menu, /likepanel, лайки/дизлайки, статистика, echo, KV, фото.

✅ Всі функції працюють стабільно.



---

🚦 Нагадування

При кожній зміні файлів → оновлювати цей чек-лист.

Не змінювати секрети без синхронізації у GitHub та Worker.

Нову функціональність додавати у нові файли (/src/commands/... або /src/feature/...)
і тільки підключати у router.js.


---

Хочеш, я ще відразу додам цей файл у гілку `main` як `docs/checklist.md`, щоб у репо він був завжди під руками?

