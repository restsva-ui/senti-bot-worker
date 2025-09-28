export type TgUser = { id?: number; language_code?: string };
export type TgChat = { id: number };
export type TgMessage = { message_id?: number; text?: string; chat: TgChat; from?: TgUser };
export type TgUpdate = { update_id?: number; message?: TgMessage };