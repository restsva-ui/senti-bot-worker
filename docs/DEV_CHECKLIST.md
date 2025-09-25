# 🛡️ DEV CHECKLIST — senti-bot-worker

Цей документ — джерело правди для розробки.  
Кожна зміна в коді чи деплой перевіряється через цей чек-ліст, щоб **нічого не зламати**.

---

## 📂 Структура репо

wrangler.toml src/ index.js          ← єдиний вхід (webhook/router + базова логіка) router.js         ← нові команди/кнопки lib/ tg.js           ← адаптер для Telegram API (іменовані експорти) commands/ menu.js likepanel.js stats.js .github/workflows/ deploy.yml        ← GitHub Actions деплой через wrangler@3 docs/ DEV_CHECKLIST.md  ← цей файл

---

## ⚙️ Wrangler
```toml
name = "senti-bot-worker"
main = "src/index.js"
workers_dev = true
account_id = "<CF_ACCOUNT_ID>"
compatibility_date = "2024-12-01"

[observability]
enabled = true
head_sampling_rate = 1   # 1 = 100% семплінг (без 1.0!)

[vars]
API_BASE_URL   = "https://api.telegram.org"
WEBHOOK_SECRET = "senti1984"

[[kv_namespaces]]
binding    = "STATE"
id         = "<KV_ID>"
preview_id = "<KV_ID>"


---

🔑 Secrets / Variables

Cloudflare Worker (Dashboard → Settings → Variables)

Secret: BOT_TOKEN → токен Telegram бота

Text: WEBHOOK_SECRET → senti1984

Text: API_BASE_URL → https://api.telegram.org

KV binding: STATE → прив’язка до KV id 7b32e2d1...


GitHub Actions (Settings → Secrets and variables → Actions)

CLOUDFLARE_API_TOKEN

CF_ACCOUNT_ID


> BOT_TOKEN зберігається тільки у Cloudflare (Secrets), не у GitHub!




---

📌 Файли

src/lib/tg.js

тільки іменовані експорти

немає export default

експортує:

tg

sendMessage

editMessageText

answerCallbackQuery

sendPhoto

sendDocument



src/router.js

відповідає тільки за нові команди:

/menu, /likepanel, /stats

callback_query: like, dislike, cmd:likepanel, cmd:stats


якщо команда не впізнана → нічого не робить (базу обробляє index.js)

KV ключі:

likes:<chatId>:<messageId> → { like, dislike }



src/index.js

приймає /webhook/<WEBHOOK_SECRET>

паралельно викликає:

routeUpdate(env, update) → кнопки/нові команди

handleBasic(update, env) → /start, /ping, /kvset, /kvget, echo, файли


відповідає Telegram миттєво (200 { ok: true })



---

🚦 Перед кожною зміною

1. Не чіпаємо базову логіку у index.js (handleBasic).


2. Новий функціонал → тільки через:

новий файл у commands/

хук у router.js



3. Імпорти → тільки з src/lib/tg.js (іменовані).


4. Шляхи імпорту перевіряємо (відносно src/).


5. Якщо з’явився новий метод у tg.js → іменований експорт + синхронізація імпорту.




---

✅ Після кожної зміни

git diff → перевірка, що зміни лише там, де треба.

деплой через GitHub Actions (або локально wrangler deploy).

перевірка:

https://senti-bot-worker.restsva.workers.dev/healthz

https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo


тести в чаті:

/ping, /start, /kvset mood happy, /kvget mood

/menu → кнопки, 👍/👎

/stats




---

🛠️ Діагностика

No matching export in tg.js
→ перевірити, що функція є у lib/tg.js і експортується іменовано.

Entry-point not found
→ у wrangler.toml має бути main = "src/index.js".
→ файл у репо.

404 на webhook
→ перевірити WEBHOOK_SECRET.
→ перевстановити webhook:

https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://senti-bot-worker.restsva.workers.dev/webhook/senti1984&allowed_updates=message,callback_query

KV не працює
→ у wrangler.toml є [[kv_namespaces]]
→ у Cloudflare → Worker → Bindings → STATE є.



---

🧰 Корисні URL

Health:
https://senti-bot-worker.restsva.workers.dev/healthz

Delete webhook:
https://api.telegram.org/bot<ТОКЕН>/deleteWebhook?drop_pending_updates=true

Set webhook:
https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://senti-bot-worker.restsva.workers.dev/webhook/senti1984&allowed_updates=message,callback_query

Get webhook info:
https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo



---

---

📌 Дії для тебе з телефона:  
1. Створи папку **`docs/`** у репо.  
2. Додай туди файл **`DEV_CHECKLIST.md`** з цим вмістом.  
3. Коміти й пуш → тепер чек-ліст завжди буде у репо.  

Хочеш, я одразу підготую git-команду (мінімальну, з телефона легко виконати), щоб швидко створити й закомітити цей файл?