import { sanitizeEmote } from '../net/protocol';

/** 「セリフ」ボタンで言うセリフ（設定で変えられる。このブラウザに保存） */
export const DEFAULT_EMOTE = '俺のRについて来れるか！？';

const EMOTE_KEY = 'car-game:emote';

export function loadEmote(): string {
  try {
    return sanitizeEmote(localStorage.getItem(EMOTE_KEY) ?? '') || DEFAULT_EMOTE;
  } catch {
    return DEFAULT_EMOTE;
  }
}

/** 保存して、実際に使うセリフを返す（空にしたら最初のセリフに戻す） */
export function saveEmote(text: string): string {
  const s = sanitizeEmote(text);
  try {
    if (s) localStorage.setItem(EMOTE_KEY, s);
    else localStorage.removeItem(EMOTE_KEY);
  } catch {
    // 保存できない環境
  }
  return s || DEFAULT_EMOTE;
}
