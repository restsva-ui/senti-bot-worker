export type CommandHandler = (ctx: { env: any; chatId: number; text: string }) => Promise<void>;

const map = new Map<string, CommandHandler>();

export function register(name: string, fn: CommandHandler) {
  map.set(name, fn);
}

export function get(name: string): CommandHandler | undefined {
  return map.get(name);
}

// Приклад echo на всяк випадок
register("echo", async ({ env, chatId, text }) => {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
});