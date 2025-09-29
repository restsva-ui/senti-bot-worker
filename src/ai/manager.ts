/**
 * Central AI manager: provider selection, fallback, retries, timeouts.
 * Works with providers created in `src/ai/providers.ts`
 */

import type { Env } from "../types"; // if you don't have it, replace Env with `any`
import { makeProviders, type AiProvider } from "./providers";

export type AiIntent =
  | "general"        // default chat / reasoning
  | "creative"       // stories, marketing, copywriting
  | "code"           // coding / debugging
  | "analysis"       // structured/concise analysis
  | "vision"         // image understanding
  | "summarize";     // long-to-short

export interface AskOptions {
  prompt: string;
  system?: string;
  intent?: AiIntent;
  temperature?: number;
  maxTokens?: number;
  // optional: image urls/base64 for vision-capable providers
  images?: Array<{ url?: string; b64?: string; mime?: string }>;
  timeoutMs?: number;       // total per-provider timeout
  prefer?: string[];        // list of provider ids to try first
}

export interface AskResult {
  text: string;
  provider: string;       // provider id
  model?: string;         // model name (if provider exposes)
  elapsedMs: number;
  tries: Array<{
    provider: string;
    ok: boolean;
    ms: number;
    error?: string;
  }>;
}

const DEFAULT_TIMEOUT = 20_000;
const MAX_ATTEMPTS = 4;     // total providers to try for one request

// poor-man timeout wrapper (safe for Workers even if provider doesn't pass AbortSignal)
const withTimeout = async <T>(p: Promise<T>, ms: number) =>
  await Promise.race<T>([
    p,
    new Promise<T>((_r, rej) =>
      setTimeout(() => rej(new Error(`timeout:${ms}`)), ms),
    ),
  ]);

export class AIManager {
  private providers: AiProvider[];
  private byId: Map<string, AiProvider>;

  static fromEnv(env: Env) {
    const ps = makeProviders(env);
    return new AIManager(ps);
  }

  constructor(providers: AiProvider[]) {
    // keep only enabled providers
    this.providers = providers.filter((p) => p.enabled);
    this.byId = new Map(this.providers.map((p) => [p.id, p]));
  }

  available(): string[] {
    return this.providers.map((p) => p.id);
  }

  /**
   * Main entry: routes a request to the best provider with resilient fallback.
   */
  async ask(options: AskOptions): Promise<AskResult> {
    if (!this.providers.length) {
      throw new Error("No AI providers configured (check env secrets).");
    }

    const intent: AiIntent = options.intent ?? detectIntent(options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;

    // build an ordered list of candidates
    const order = this.rankProviders(intent, options);
    const prefer = (options.prefer ?? []).map((id) => this.byId.get(id)).filter(Boolean) as AiProvider[];
    const candidates = uniqueProviders([...prefer, ...order]).slice(0, MAX_ATTEMPTS);

    const tries: AskResult["tries"] = [];
    const startedAt = Date.now();

    for (const p of candidates) {
      const t0 = Date.now();
      try {
        const text = await withTimeout(
          p.complete({
            prompt: options.prompt,
            system: options.system,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            images: options.images,
            intent,
          }),
          timeoutMs,
        );

        const elapsedMs = Date.now() - startedAt;
        tries.push({ provider: p.id, ok: true, ms: Date.now() - t0 });

        return {
          text,
          provider: p.id,
          model: p.model,
          elapsedMs,
          tries,
        };
      } catch (e: any) {
        const msg = normalizeErr(e);
        tries.push({ provider: p.id, ok: false, ms: Date.now() - t0, error: msg });
        // skip to next provider on known transient issues
        if (!isRetryable(msg)) break; // hard error -> stop early
      }
    }

    const last = tries.at(-1);
    const err = last?.error ?? "All providers failed";
    throw new Error(
      `AIManager: no answer. Intent=${intent}. Tries=${JSON.stringify(tries)}. LastError=${err}`,
    );
  }

  /**
   * Provider ranking heuristics (simple & stable).
   * Adjusts order based on declared strengths and task options.
   */
  private rankProviders(intent: AiIntent, opts: AskOptions): AiProvider[] {
    const isVision = !!(opts.images?.length);
    const scored = this.providers.map((p) => {
      let score = 0;

      // base reliability
      score += p.reliability ?? 0; // 0..10

      // match by strengths
      if (p.strengths?.includes(intent)) score += 4;

      // vision necessity
      if (isVision) score += p.vision ? 5 : -100;

      // budget-friendly (prefer free/cheap first)
      if (p.tier === "free") score += 3;
      if (p.tier === "cheap") score += 1;

      // model-size preference for long outputs
      if ((opts.maxTokens ?? 0) > 2000 && p.longContext) score += 2;

      return { p, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }
}

/* ----------------------- helpers ----------------------- */

function detectIntent(opts: AskOptions): AiIntent {
  if (opts.images?.length) return "vision";
  const q = opts.prompt.toLowerCase();

  if (/\b(write|story|slogan|ad copy|poem|tweet|post)\b/.test(q)) return "creative";
  if (/\b(code|typescript|python|bug|stacktrace|trace|error:|refactor)\b/.test(q)) return "code";
  if (/\bsummary|summarize|shorten|tl;dr\b/.test(q)) return "summarize";
  if (/\bcompare|analy(s|z)e|pros|cons|evaluate|why|how\b/.test(q)) return "analysis";

  return "general";
}

function uniqueProviders(list: AiProvider[]) {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function normalizeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

/** Retryable = rate limits, timeouts, 5xx, provider-offline, quota, overload */
function isRetryable(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("rate") ||
    m.includes("quota") ||
    m.includes("overload") ||
    m.includes("429") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("temporary")
  );
}

/* -------------- Minimal provider interface hint --------------
In `src/ai/providers.ts` make sure you export:

export type AiProvider = {
  id: string;
  model?: string;
  enabled: boolean;
  tier?: "free" | "cheap" | "paid";
  strengths?: AiIntent[];
  reliability?: number; // 0..10
  vision?: boolean;
  longContext?: boolean;
  complete: (args: {
    prompt: string;
    system?: string;
    temperature?: number;
    maxTokens?: number;
    images?: Array<{url?: string; b64?: string; mime?: string}>;
    intent: AiIntent;
  }) => Promise<string>;
};

export function makeProviders(env: Env): AiProvider[] { ... }

---------------------------------------------------------------- */