import { tgSendMessage } from "../../utils/telegram";

type EnvAll = {
  BOT_TOKEN?: string;
  SENTI_CACHE?: KVNamespace;
};

/** безпечне base64-кодування великих буферів */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000; // 32KB
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(part) as any);
  }
  return btoa(binary);
}

function guessMimeFromPath(filePath?: string | null): string {
  const p = (filePath || "").toLowerCase();
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

export async function handlePhoto(update: any, env: EnvAll, chatId: number) {
  const photos = update?.message?.photo as { file_id: string }[] | undefined;
  const best = photos?.[photos.length - 1];
  if (!best?.file_id) return;

  // збережемо для сумісності старі ключі з file_id (як у вашій версії)
  await env.SENTI_CACHE?.put(`lastPhoto:${chatId}`, best.file_id, { expirationTtl: 600 });
  await env.SENTI_CACHE?.put(`last_photo:${chatId}`, best.file_id, { expirationTtl: 600 });

  // якщо є токен і KV — одразу закладемо inline-копію (надійніше для візії)
  if (env.BOT_TOKEN && env.SENTI_CACHE) {
    try {
      // 1) getFile → дістати file_path
      const urlGetFile = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(best.file_id)}`;
      const r1 = await fetch(urlGetFile);
      if (r1.ok) {
        const j: any = await r1.json();
        const filePath: string | undefined = j?.result?.file_path;
        if (filePath) {
          // 2) скачати фото як байти
          const urlFile = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
          const r2 = await fetch(urlFile);
          if (r2.ok) {
            const buf = await r2.arrayBuffer();
            const base64 = arrayBufferToBase64(buf);
            const mime = guessMimeFromPath(filePath);

            // 3) покласти inline в KV під окремим ключем (1 година)
            const inlineKey = `photo:last:${chatId}`;
            const payload = JSON.stringify({ mime, data: base64, ts: Date.now(), filePath });
            await env.SENTI_CACHE.put(inlineKey, payload, { expirationTtl: 3600 });
          }
        }
      }
    } catch {
      // тихо ігноруємо — все одно залишився шлях через file_id
    }
  }

  await tgSendMessage(
    env as any,
    chatId,
    "Фото отримав ✅ Тепер надішли коротку підказку текстом — що саме проаналізувати?"
  );
}