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

const SHAPE_KEY = 'car-game:face-shape';

/** 顔写真から読み取った顔の形（特徴点）。写真と同じく、このブラウザにだけ置く */
export function loadFaceShape(): string | null {
  try {
    return localStorage.getItem(SHAPE_KEY);
  } catch {
    return null;
  }
}

export function saveFaceShape(encoded: string | null): void {
  try {
    if (encoded) localStorage.setItem(SHAPE_KEY, encoded);
    else localStorage.removeItem(SHAPE_KEY);
  } catch {
    // 保存できなくても、そのセッションの間は使える
  }
}

const SHAPE_MODE_KEY = 'car-game:face-3d';

/** 顔写真を立体にするか（外すと写真をそのまま貼る）。初期値は立体にする */
export function loadFace3d(): boolean {
  try {
    return localStorage.getItem(SHAPE_MODE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveFace3d(enabled: boolean): void {
  try {
    localStorage.setItem(SHAPE_MODE_KEY, enabled ? '1' : '0');
  } catch {
    // 保存できなくても、そのセッションの間は使える
  }
}
