import { Tg, type TgUpdate } from './telegram';

export interface Env {
  AI: any; // Workers AI binding
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string; // set to: senti1984 (per your note)
  // Optional: override for tests
  TG_API_BASE?: string; // default https://api.telegram.org
}

const TG_BASE_DEFAULT = 'https://api.telegram.org';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response('Senti bot worker is up ✅', { status: 200 });
    }

    if (url.pathname === '/webhook' && req.method === 'POST') {
      // Simple secret check
      const secret = req.headers.get('x-api-key') || url.searchParams.get('secret') || '';
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }

      const update = (await req.json()) as TgUpdate;
      const tgBase = env.TG_API_BASE || TG_BASE_DEFAULT;
      try {
        const message = update.message || update.edited_message;
        if (!message) return new Response('ok');

        // Commands
        if (message.text) {
          const text = message.text.trim();
          if (text === '/start') {
            await Tg.sendMessage(tgBase, env.TELEGRAM_BOT_TOKEN, message.chat.id,
              'Привіт! Надішли фото — я опишу його українською у 2–3 реченнях.' , message.message_id);
            return new Response('ok');
          }
        }

        // Photo flow
        if (message.photo && message.photo.length > 0) {
          // Take the largest size
          const best = message.photo.at(-1)!;
          const fileInfo = await Tg.getFile(tgBase, env.TELEGRAM_BOT_TOKEN, best.file_id);
          const file_path = fileInfo?.result?.file_path as string | undefined;
          if (!file_path) {
            await Tg.sendMessage(tgBase, env.TELEGRAM_BOT_TOKEN, message.chat.id, 'Не вдалося отримати файл фото.', message.message_id);
            return new Response('ok');
          }

          const downloadUrl = Tg.fileDownloadUrl(tgBase, env.TELEGRAM_BOT_TOKEN, file_path);
          const imgRes = await fetch(downloadUrl);
          const imgBuf = await imgRes.arrayBuffer();
          const bytes = new Uint8Array(imgBuf);

          const prompt = 'Опиши фото лаконічно українською у 2–3 реченнях. Уникай припущень і фантазій.';

          // Workers AI — llama-3.2-11b-vision-instruct
          const aiRes = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
            prompt,
            image: [...bytes],
          });

          const output = (aiRes?.response || aiRes?.result || '').toString().trim();
          const safe = output && output.length > 0 ? output : 'Не впевнений. Спробуй інший кадр або кращу якість.';

          await Tg.sendMessage(tgBase, env.TELEGRAM_BOT_TOKEN, message.chat.id, safe, message.message_id);
          return new Response('ok');
        }

        // Fallback: echo short help
        await Tg.sendMessage(tgBase, env.TELEGRAM_BOT_TOKEN, message.chat.id,
          'Надішли фото — я опишу його українською у 2–3 реченнях. Команда: /start', message.message_id);
        return new Response('ok');
      } catch (err) {
        console.error('webhook error', err);
        // best-effort error notice
        try {
          const chatId = (update.message || update.edited_message)?.chat.id;
          if (chatId) {
            await Tg.sendMessage(env.TG_API_BASE || TG_BASE_DEFAULT, env.TELEGRAM_BOT_TOKEN, chatId, 'Сталася помилка обробки. Спробуй ще раз.');
          }
        } catch {}
        return new Response('ok');
      }
    }

    return new Response('Not found', { status: 404 });
  }
};
