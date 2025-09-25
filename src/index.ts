// src/index.ts
import { makeRouter } from "./router";

export interface Env {
  BOT_TOKEN: string;
  // обов'язково
  WEBHOOK_SECRET?: string;          // опційно
  API_BASE_URL?: string;            // опційно, дефолт https://api.telegram.org
  OWNER_ID?: string;                // опційно, для /test
}

const router = makeRouter();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await router.handle(request, env, ctx);
    } catch (err: any) {
      console.error("UNHANDLED_ERROR", { message: err?.message, stack: err?.stack });
      return new Response(
        JSON.stringify({ error: "Internal Error" }),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }
};