# 🧠 Senti Bot Worker

Cloudflare Worker для Telegram-бота Senti: маршрутизація запитів до моделей, пам’ять діалогу, погода, Google Drive, checklist, архіви та нічні задачі.

## Локальна перевірка

```bash
npm install
npm test
```

Команда перевіряє синтаксис критичних модулів і запускає статичні regression-checks для webhook, Telegram API, адмін-маршрутів та конфігурації секретів.

## Деплой

```bash
npm run deploy
```

Push у `main` запускає GitHub Actions: спочатку перевірки, потім deploy у Cloudflare. Pull request запускає лише перевірки.

## Обов’язкові Cloudflare Secrets

Секрети не можна додавати у `wrangler.toml`, README, код або URL у документації.

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TG_WEBHOOK_SECRET
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Рекомендації:

- `TG_WEBHOOK_SECRET` використовується лише для перевірки Telegram webhook.
- `ADMIN_SECRET` захищає адмінські сторінки та операції запису.
- `WEBHOOK_SECRET` використовується для внутрішніх cron/CI endpoint-ів.
- Кожен секрет повинен бути окремим випадковим значенням щонайменше 32 байти.
- Після витоку секрет потрібно негайно замінити, а не просто видалити з останнього commit.

## Основні маршрути

- `GET /health` — стан Worker.
- `POST /webhook` — Telegram webhook, перевіряється заголовок `x-telegram-bot-api-secret-token`.
- `GET /selftest` — локальна перевірка ключових модулів.
- `/admin/checklist?s=...` — checklist, вимагає `ADMIN_SECRET`.
- `/admin/statut?s=...` — statut, вимагає `ADMIN_SECRET`.
- `/admin/repo/html?s=...` — керування архівами.
- `/admin/brain?s=...` — операції brain.

Адмінські секрети краще передавати заголовком:

```text
Authorization: Bearer <ADMIN_SECRET>
```

Query-параметр `?s=` залишений для сумісності з Telegram inline-кнопками, але не повинен потрапляти у публічні логи чи скриншоти.

## Сховища

| Binding | Призначення |
|---|---|
| `LIKES_KV` | коротка пам’ять користувачів |
| `STATE_KV` | інсайти та аналітика |
| `CHECKLIST_KV` | checklist, журнал, архівні покажчики |
| `USER_OAUTH_KV` | Google OAuth tokens |
| `DEDUP_KV` | захист від повторної обробки |
| `LEARN_QUEUE_KV` | черга навчання |
| `LEARN_BUCKET` | R2 для learn-даних |
| `REPO_BUCKET` | R2 для архівів |

> `CHECKLIST_KV` і `TODO_KV` зараз використовують один namespace ID. Перед розділенням потрібно запланувати міграцію даних.

## Безпека після оновлення

Після merge обов’язково:

1. Згенерувати нові `TG_WEBHOOK_SECRET`, `ADMIN_SECRET` і `WEBHOOK_SECRET`.
2. Записати їх через `wrangler secret put`.
3. Перевстановити Telegram webhook з новим `secret_token`.
4. Перевірити `/health`, `/selftest` і звичайне текстове повідомлення боту.
5. Переконатися, що анонімний запит до `/admin/checklist` повертає `401`.
