# Ч-Л: senti-bot-worker

## Факти
- **Платформа:** Cloudflare Workers (TypeScript, Wrangler).
- **KV:** LIKES_KV → namespace `senti-state`.
- **Secrets у Cloudflare:**  
  - BOT_TOKEN ✅  
  - API_BASE_URL=https://api.telegram.org ✅  
  - OWNER_ID=784869835 ✅  
  - GROQ_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, CF Vision, PREMIUM_CODE, REDIS_URL, REDIS_TOKEN (для AI/доп. функцій).  
- **Secrets у GitHub Actions:** CF_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, WEBHOOK_SECRET (але є опечатка: CLOUDLFARE_API_TOKEN ❌).  
- **Wrangler binding:** `LIKES_KV` підключений як `senti-state`.

## Виконані кроки
- KV створено та підключено.  
- Secrets налаштовані у Cloudflare та GitHub.  
- Код перевірено на базову логіку команд (`/start`, `/ping`, `/likepanel`, `/wiki`).  

## Наступні кроки
1. ➡️ Додати `WEBHOOK_SECRET` у Cloudflare (зараз є лише в GitHub).  
2. ➡️ Додати перевірку заголовка `X-Telegram-Bot-Api-Secret-Token` у `src/index.ts`.  
3. ➡️ Виправити помилку у назві секрету в GitHub (видалити `CLOUDLFARE_API_TOKEN`).  
4. ➡️ Додати антидубль через KV на `update_id`.  
5. ➡️ Уніфікувати `Env` типи (щоб не було дублів).