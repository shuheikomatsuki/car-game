/**
 * このブラウザに残したプレイデータ（タイムアタックの自己ベストとゴースト・勝ったライバル・ランキングに送った印）を消す。
 * 名前・サウンド・ハンドルなどの設定と、ランキングで同じ人の記録をまとめる id は残す。
 */

const PLAY_DATA_PREFIXES = ['car-game:time-attack:', 'car-game:beaten-rivals', 'car-game:uploaded:', 'car-game:my-entry:'];

type KeyStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/** プレイデータの key か */
export function isPlayDataKey(key: string): boolean {
  return PLAY_DATA_PREFIXES.some((p) => key.startsWith(p));
}

/** プレイデータを消して、消した数を返す（localStorage を使えなければ 0） */
export function clearPlayData(storage: KeyStorage | null = safeLocalStorage()): number {
  if (!storage) return 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && isPlayDataKey(k)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
  return keys.length;
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
