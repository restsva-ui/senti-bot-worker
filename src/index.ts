// src/index.ts
import {
  Env,
  cmdPing,
  cmdStart,
  cmdHealthMessage,
  healthJson,
  sendTelegramMessage,
} from "./commands";

type TgUser = { id: number; is_bot: boolean; first_name?: string; username?: string };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel"; username?: string; first_name?: string };
type TgMessage = { message_id: number; date: number; text?: string; from?: TgUser; chat: TgChat; entities?: {offset:number;length:number;type:string}[] };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: any };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      // 1) health endpoint (GET)
      if (request.method === "GET" && pathname === "/health") {
        return healthJson();
      }

      // 2) webhook приймає POST /webhook/senti1984
      if (request.method === "POST" && pathname === "/webhook/senti1984") {
        const update = (await request.json()) as TgUpdate;

        // Витягнемо текст команди
        const msg = update.message;
        const text = msg?.text?.trim() || "";

        // Маршрутизація команд
        let reply: string | null = null;
        if (text.startsWith("/ping")) reply = cmdPing().text;
        else if (text.startsWith("/start")) reply = cmdStart().text;
        else if (text.startsWith("/health")) reply = cmdHealthMessage().text;

        // Якщо команда впізнана — відповідаємо
        if (reply && msg?.chat?.id) {
          await sendTelegramMessage(env, msg.chat.id, reply);
        }

        // Telegram очікує 200 OK швидко
        return new Response("ok", { status: 200 });
      }

      // 3) усе інше
      if (request.method === "GET") {
        return new Response("Not found", { status: 404 });
      }
      return new Response("Method not allowed", { status: 405 });
    } catch (err) {
      return new Response(`Internal error: ${(err as Error).message}`, { status: 500 });
    }
  },
};