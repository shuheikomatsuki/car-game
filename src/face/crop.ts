/**
 * 顔写真の切り抜き枠の計算（描画に依存しない部分）。
 * 枠は size × size の正方形で、画像の点 (ix, iy) は枠の (ix * scale + x, iy * scale + y) に写る。
 */
export interface CropView {
  scale: number;
  x: number;
  y: number;
}

/** 枠の中の顔の目安（枠の大きさに対する割合）。キャラクターの頭への貼り方もこれに合わせる */
export const FACE_GUIDE = {
  centerX: 0.5,
  centerY: 0.52,
  radiusX: 0.34,
  radiusY: 0.44,
  eyeY: 0.46,
  mouthY: 0.74,
} as const;

/** これ以上は拡大しない（元画像の短辺に対する倍率） */
const MAX_ZOOM = 8;

/** 最初の表示: 画像の短辺が枠にちょうど収まるようにして中央に置く */
export function fitView(imageWidth: number, imageHeight: number, size: number): CropView {
  const scale = size / Math.min(imageWidth, imageHeight);
  return { scale, x: (size - imageWidth * scale) / 2, y: (size - imageHeight * scale) / 2 };
}

export function minScale(imageWidth: number, imageHeight: number, size: number): number {
  return size / Math.min(imageWidth, imageHeight);
}

/** 画像が常に枠全体を覆うように位置と倍率を制限する */
export function clampView(view: CropView, imageWidth: number, imageHeight: number, size: number): CropView {
  const min = minScale(imageWidth, imageHeight, size);
  const scale = Math.min(min * MAX_ZOOM, Math.max(min, view.scale));
  const clamp = (v: number, length: number) => Math.min(0, Math.max(size - length * scale, v));
  return { scale, x: clamp(view.x, imageWidth), y: clamp(view.y, imageHeight) };
}

/** 枠の点 (px, py) を中心に拡大・縮小する（その点の下にある画像の位置は動かない） */
export function zoomAt(view: CropView, scale: number, px: number, py: number): CropView {
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}
