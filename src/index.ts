import { Tg, type TgUpdate } from './telegram';

const APP_VERSION = 'Senti Worker v0.1.2';
const TG_BASE_DEFAULT = 'https://api.telegram.org';

export interface Env {
  AI: any;                         // Workers AI binding (@cf/meta/llama-3.2-11b-vision-instruct)
  TELEGRAM_BOT_TOKEN: string;      // GitHub Secret → wrangler secret put
  WEBHOOK_SECRET: string;          // має дорівнювати secret_token у setWebhook (senti1984)
  TG_API_BASE?: string;            // опційно (дефолт: https://api.telegram.org)
}

function ok(text = 'ok', status = 200) {
  return new Response(text, { status });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // -------- Healthcheck --------
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(`${APP_VERSION} — up ✅`, { status: 200 });
    }

    // -------- Telegram Webhook --------
    if (url.pathname === '/webhook' && req.method === 'POST') {
      // ✅ Telegram надсилає секрет у X-Telegram-Bot-Api-Secret-Token
      const tgSecret =
        req.headers.get('x-telegram-bot-api-secret-token') ||
        url.searchParams.get('secret') ||
        '';
      if (tgSecret !== env.WEBHOOK_SECRET) {
        console.warn('[403] Bad webhook secret');
        return new Response('Forbidden', { status: 403 });
      }

      let update: TgUpdate;
      try {
        update = (await req.json()) as TgUpdate;
      } catch {
        console.warn('[400] Bad JSON');
        return new Response('Bad Request', { status: 400 });
      }

      const tgBase = env.TG_API_BASE || TG_BASE_DEFAULT;
      const msg = update.message || update.edited_message;
      if (!msg) return ok(); // нічого обробляти

      try {
        // ---------- Commands ----------
        if (msg.text) {
          const text = msg.text.trim();

          if (text === '/start') {
            await Tg.sendMessage(
              tgBase,
              env.TELEGRAM_BOT_TOKEN,
              msg.chat.id,
              'Привіт! Надішли фото — я опишу його українською у 2–3 реченнях.'
            );
            return ok();
          }

          if (text === '/version') {
            await Tg.sendMessage(
              tgBase,
              env.TELEGRAM_BOT_TOKEN,
              msg.chat.id,
              `${APP_VERSION}\nМодель: @cf/meta/llama-3.2-11b-vision-instruct`
            );
            return ok();
          }

          if (text === '/help') {
            await Tg.sendMessage(
              tgBase,
              env.TELEGRAM_BOT_TOKEN,
              msg.chat.id,
              'Надішли фото — я поверну короткий опис українською. Команди: /start, /version, /help'
            );
            return ok();
          }
        }

        // ---------- Photo flow ----------
        if (msg.photo && msg.photo.length > 0) {
          // беремо найбільшу версію фото
          const best = msg.photo.at(-1)!;

          const fileInfo = await Tg.getFile(tgBase, env.TELEGRAM_BOT_TOKEN, best.file_id);
          const file_path = fileInfo?.result?.file_path as string | undefined;
          if (!file_path) {
            await Tg.sendMessage(
              tgBase,
              env.TELEGRAM_BOT_TOKEN,
              msg.chat.id,
              'Не вдалося отримати файл фото.'
            );
            return ok();
          }

          const downloadUrl = Tg.fileDownloadUrl(tgBase, env.TELEGRAM_BOT_TOKEN, file_path);
          const imgRes = await fetch(downloadUrl);
          if (!imgRes.ok) {
            console.error('Image download failed', imgRes.status, await imgRes.text().catch(() => ''));
            await Tg.sendMessage(
              tgBase,
              env.TELEGRAM_BOT_TOKEN,
              msg.chat.id,
              'Проблема зі скачуванням фото. Спробуй ще раз.'
            );
            return ok();
          }

          const imgBuf = await imgRes.arrayBuffer();
          const bytes = new Uint8Array(imgBuf);

          const prompt =
            'Опиши фото лаконічно українською у 2–3 реченнях. Будь точним, без вигадок і припущень.';

          // Workers AI — vision instruct
          const aiRes = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
            prompt,
            image: [...bytes],
          });

          const output = (aiRes?.response || aiRes?.result || '').toString().trim();
          const reply =
            output && output.length > 0
              ? output
              : 'Не впевнений. Спробуй інший кадр або кращу якість.';

          await Tg.sendMessage(tgBase, env.TELEGRAM_BOT_TOKEN, msg.chat.id, reply);
          return ok();
        }

        // ---------- Fallback ----------
        await Tg.sendMessage(
          tgBase,
          env.TELEGRAM_BOT_TOKEN,
          msg.chat.id,
          'Надішли фото — я опишу його українською у 2–3 реченнях. Команди: /start, /version, /help'
        );
        return ok();
      } catch (err: any) {
        console.error('webhook error:', err?.stack || err?.message || err);
        // Тихо повідомляємо користувачу (якщо можемо)
        try {
          await Tg.sendMessage(
            env.TG_API_BASE || TG_BASE_DEFAULT,
            env.TELEGRAM_BOT_TOKEN,
            (update.message || update.edited_message)!.chat.id,
            'Сталася помилка обробки. Спробуй ще раз.'
          );
        } catch {}
        return ok(); // не лякаємо Telegram 5xx
      }
    }

    // -------- Not Found --------
    return new Response('Not found', { status: 404 });
  },
};