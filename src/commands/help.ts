import { Env } from "../index";

export async function handleHelp(env: Env, chatId: number) {
  const text = `
*Доступні команди:*

/start – запуск і вітання  
/ping – перевірка зв’язку (відповідь pong)  
/health – перевірка стану сервера  
/help – список команд  

⚡ В майбутньому тут зʼявляться нові функції (AI, інтеграції тощо).
  `;

  await sendMessage(env, chatId, text);
}

async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}