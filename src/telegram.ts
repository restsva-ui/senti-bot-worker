export type TgUpdate = {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
};

export type TgMessage = {
  message_id: number
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number };
  text?: string;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>
};

export function isPhotoMessage(m?: TgMessage): m is TgMessage & { photo: NonNullable<TgMessage['photo']> } {
  return !!m && Array.isArray(m.photo) && m.photo.length > 0;
}

export const Tg = {
  api(base: string, token: string, method: string, params?: Record<string, unknown>) {
    const url = `${base}/bot${token}/${method}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params ?? {}),
    }).then(r => r.json());
  },
  async sendMessage(base: string, token: string, chat_id: number, text: string, reply_to_message_id?: number) {
    return this.api(base, token, 'sendMessage', { chat_id, text, reply_to_message_id, parse_mode: 'HTML' });
  },
  async getFile(base: string, token: string, file_id: string) {
    return this.api(base, token, 'getFile', { file_id });
  },
  fileDownloadUrl(base: string, token: string, file_path: string) {
    return `${base}/file/bot${token}/${file_path}`;
  }
};
