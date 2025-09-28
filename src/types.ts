export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

export type TgUser = { language_code?: string };
export type TgChat = { id: number };

export type TgMessageEntity = {
  type: "bot_command" | string;
  offset: number;
  length: number;
};

export type TgMessage = {
  text?: string;
  chat: TgChat;
  from?: TgUser;
  entities?: TgMessageEntity[];
};

export type TgUpdate = { message?: TgMessage };