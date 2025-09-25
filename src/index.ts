// src/index.ts
import { makeRouter } from "./router";

export interface Env {
  BOT_TOKEN: string;
  // обов'язково
  WEBHOOK_SECRET: string;
  // обов'язково
  API_BASE_URL?: string; // опц., дефолт https://api.telegram.org
  OWNER_ID?: string;     // опц. для /test
}

const router = makeRouter();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Всі секрети/константи береться з env (env.BOT_TOKEN, env.WEBHOOK_SECRET, env.API_BASE_URL ...)
      return await router.handle(request, env, ctx);
    } catch (err: any) {
      console.error("UNHANDLED_ERROR", { message: err?.message, stack: err?.stack });
      return new Response("Internal Error", { status: 500 });
    }
  },
};