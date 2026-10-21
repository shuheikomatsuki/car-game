import { type CropView, FACE_GUIDE } from './crop';

/** キャラクターの肌の色（顔写真の周りをこの色になじませる） */
export const SKIN_COLOR = '#f2d0b5';

/**
 * 切り抜いた写真から、頭の正面に貼るテクスチャを作る。
 * 顔の枠（楕円）の外側は肌の色へぼかして、頭の球となじませる。
 */
export function composeFaceTexture(
  image: CanvasImageSource,
  view: CropView,
  frameSize: number,
  size = 512,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const k = size / frameSize;
  ctx.setTransform(view.scale * k, 0, 0, view.scale * k, view.x * k, view.y * k);
  ctx.drawImage(image, 0, 0);

  // 楕円の縁を少しぼかして切り抜く
  ctx.setTransform(
    FACE_GUIDE.radiusX * size,
    0,
    0,
    FACE_GUIDE.radiusY * size,
    FACE_GUIDE.centerX * size,
    FACE_GUIDE.centerY * size,
  );
  const mask = ctx.createRadialGradient(0, 0, 0.8, 0, 0, 1);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.fillRect(-2, -2, 4, 4);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = SKIN_COLOR;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
