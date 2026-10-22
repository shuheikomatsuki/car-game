type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

/** ホーム画面に追加したアイコンから開いている（アドレスバーが無い） */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** ページから全画面にできる（Android・iPad など。iPhone はできない） */
export function canRequestFullscreen(): boolean {
  const doc = document as FullscreenDocument;
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}

export function isFullscreen(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** 全画面にして、できれば横向きに固定する（ユーザーが触れた操作の中から呼ぶこと） */
export async function enterFullscreen(): Promise<void> {
  const root = document.documentElement as FullscreenElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else root.webkitRequestFullscreen?.();
  } catch {
    return;
  }
  // 横向き固定は対応していない端末が多いので、失敗しても気にしない
  await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape').catch(() => undefined);
}

/** ホーム画面に追加しないとアドレスバーを消せない端末（iPhone の Safari） */
export function needsHomeScreenForFullscreen(): boolean {
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return iOS && !isStandalone() && !canRequestFullscreen();
}
