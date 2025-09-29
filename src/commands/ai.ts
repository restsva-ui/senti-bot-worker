// src/commands/ai.ts
type Env = {
  BOT_TOKEN: string;
  API_BASE_URL: string;
};

type Update = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
};

async function reply(env: Env, chatId: number, text: string, replyTo?: number) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    reply_to_message_id: replyTo,
  };
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Іменований експорт для реєстру */
export async function ai(update: Update, env: Env) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = msg.text ?? "";
  const args = text.split(/\s+/).slice(1).join(" ").trim();

  if (!args) {
    await reply(
      env,
      chatId,
      "🤖 *AI режим* (бета)\nНадішли: `/ai <запит>`",
      msg.message_id
    );
    return;
  }

  // Поки що це заглушка. Пізніше під’єднаємо маршрутизацію до моделей.
  await reply(
    env,
    chatId,
    `✅ Прийняв запит: _${args}_\n(поки відповідає заглушка)`,
    msg.message_id
  );
}

/** default-експорт для сумісності з існуючим роутером */
export default ai;