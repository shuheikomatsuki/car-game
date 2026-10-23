import * as THREE from 'three';

/** 車の上に出す吹き出し（エモート）の Sprite */
export function createBubble(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 40px system-ui, sans-serif';
  const w = Math.min(500, ctx.measureText(text).width + 44);
  const x = (512 - w) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.roundRect(x, 6, w, 76, 22);
  ctx.fill();
  // 下向きのしっぽ
  ctx.beginPath();
  ctx.moveTo(244, 80);
  ctx.lineTo(256, 104);
  ctx.lineTo(268, 80);
  ctx.fill();
  ctx.fillStyle = '#16181c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 45, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 壁や他の車に隠れても読めるよう、奥行きを無視して手前に描く
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  sprite.renderOrder = 10;
  sprite.scale.set(3.2, 0.7, 1);
  sprite.position.y = 3.0;
  return sprite;
}

function disposeSprite(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}

/** root（車体）の上に吹き出しを ms だけ出す。前の吹き出しが残っていれば置き換える */
export function attachBubble(root: THREE.Object3D, text: string, ms = 3500): void {
  const old = root.userData.bubble as { sprite: THREE.Sprite; timer: number } | undefined;
  if (old) {
    window.clearTimeout(old.timer);
    root.remove(old.sprite);
    disposeSprite(old.sprite);
  }
  const sprite = createBubble(text);
  root.add(sprite);
  const timer = window.setTimeout(() => {
    root.remove(sprite);
    disposeSprite(sprite);
    if ((root.userData.bubble as { sprite: THREE.Sprite } | undefined)?.sprite === sprite) delete root.userData.bubble;
  }, ms);
  root.userData.bubble = { sprite, timer };
}
