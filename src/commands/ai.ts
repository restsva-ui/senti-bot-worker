// src/commands/ai.ts
// Проста заглушка для /ai (бетa): приймає запит і відповідає підтвердженням.
// Має і named, і default експорти, щоб не ламати імпорти реєстру.

type Ctx = any;
type Msg = any;

function reply(ctx: Ctx, text: string, extra: any = {}) {
  if (typeof ctx?.reply === "function") return ctx.reply(text, extra);
  if (typeof ctx?.send === "function") return ctx.send(text, extra);
  return text;
}

function parsePrompt(text: string): string {
  // видаляємо "/ai" спочатку і обрізаємо пробіли
  return text.replace(/^\/ai\b/, "").trim();
}

export async function ai(ctx: Ctx, msg: Msg) {
  const text: string = msg?.text ?? "";
  const prompt = parsePrompt(text);

  if (!prompt) {
    await reply(ctx, "🤖 AI режим (бета)\nНадішли: `/ai <запит>`", {
      parse_mode: "Markdown",
    });
    return;
  }

  // Поки що — заглушка (echo-підтвердження), як на твоєму скріні
  await reply(
    ctx,
    `✅ Прийняв запит: _${prompt}_\n(поки відповідає заглушка)`,
    { parse_mode: "Markdown" }
  );
}

export { ai as aiExport };
export default ai;