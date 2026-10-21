/**
 * 顔写真の保存先。このブラウザの localStorage にだけ置き、どこにも送信しない。
 * プライベートウィンドウなどで保存できない場合は、そのセッションの間だけ使う。
 */
const KEY = 'car-game:face';

export function loadFace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveFace(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(KEY, dataUrl);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
