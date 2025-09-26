// src/index.ts
import { makeRouter } from "./router";
import type { Env } from "./config";

const router = makeRouter();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await router.handle(request, env, ctx);
    } catch (err: any) {
      console.error("UNHANDLED_ERROR", { message: err?.message, stack: err?.stack });
      return new Response("Internal Error", { status: 500 });
    }
  },
};