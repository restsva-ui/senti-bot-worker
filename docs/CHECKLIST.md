Зрозумів 👍
Тоді я просто викладу чеклист тут у повідомленні.
Скопіюєш собі у файл CHECKLIST.md перед переходом у новий чат.


---

✅ Чеклист для senti-bot-worker

1. Секрети та змінні середовища (Cloudflare Workers → Settings → Variables)

🔑 BOT_TOKEN — токен бота Telegram (Secret)

🌍 API_BASE_URL=https://api.telegram.org (Plaintext)

🤖 AI_ENABLED=true (Plaintext, якщо треба)

🔑 CF_AI_GATEWAY_BASE — endpoint Cloudflare AI (опціонально, якщо буде AI)

🔑 CF_Vision — ключ для Cloudflare Vision (опціонально)


Перевір, що:

BOT_TOKEN створений саме як Secret.

Назви ключів збігаються з тим, що у коді (env.BOT_TOKEN).

Нема конфліктів із TELEGRAM_API_KEY чи іншими зайвими змінними.



---

2. Команди для перевірки

Healthcheck

curl https://senti-bot-worker.restsva.workers.dev/health

Очікувано:

{"ok":true,"ts":<timestamp>}

Налаштування вебхука

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
     -d "url=https://senti-bot-worker.restsva.workers.dev/webhook"

Перевірка вебхука

curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"

Очікувано:

{"ok":true,"result":{"url":"https://senti-bot-worker.restsva.workers.dev/webhook", ...}}


---

3. Файли у репо (ключові)

src/index.ts

Імпортує COMMANDS із registry.ts.

Обробляє /webhook.

Витягує BOT_TOKEN із env.

Відповідає через sendMessage.


src/commands/registry.ts

Реєстр усіх команд.

Має export const COMMANDS.

Для кожної команди робимо безпечний імпорт:

import helpNamed, { help as helpExport } from "./help";
const help = helpExport ?? helpNamed;

Додаємо у COMMANDS.


src/commands/help.ts

Має export async function help(ctx) (і можна export default help).

Виводить список команд.


src/commands/ping.ts

Має export async function ping(ctx) (і можна export default ping).

Відповідає "pong".


src/commands/start.ts

Має export async function start(ctx) (і можна export default start).

Вітальне повідомлення.



---

4. Як тестувати

1. Викликати /help у Telegram → бот повинен відповісти списком.


2. Викликати /ping → бот має відповісти pong.


3. Викликати /start → бот має привітати.


4. Перевірити /wiki Київ → бот відповідає даними з Вікі.


5. Якщо AI_ENABLED=true → /ai <запит> працює.




---

5. Типові помилки

❌ No matching export → у файлі команди не було export function ....

❌ process.env.BOT_TOKEN → треба env.BOT_TOKEN.

❌ Бот мовчить → вебхук не зареєстрований.

❌ 200 у логах, але нема відповіді → sendMessage не викликається у хендлері.



---

Хочеш, я одразу складу цей чеклист у повний Markdown-файл і віддам текстом тут, щоб можна було скопіювати без втрат?

