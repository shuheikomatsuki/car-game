import * as THREE from 'three';

/** ミラーの表示: なし・バックミラーだけ・サイドミラーだけ・バックミラーとサイドミラー */
export type MirrorMode = 'off' | 'rear' | 'side' | 'all';

export const MIRROR_MODES: readonly { id: MirrorMode; label: string }[] = [
  { id: 'off', label: 'なし' },
  { id: 'rear', label: 'バックミラー' },
  { id: 'side', label: 'サイドのみ' },
  { id: 'all', label: 'バック＋サイド' },
];

const MIRROR_KEY = 'car-game:mirrors';

export function loadMirrorMode(): MirrorMode {
  try {
    const v = localStorage.getItem(MIRROR_KEY);
    return MIRROR_MODES.some((m) => m.id === v) ? (v as MirrorMode) : 'rear';
  } catch {
    return 'rear';
  }
}

export function saveMirrorMode(mode: MirrorMode): void {
  try {
    localStorage.setItem(MIRROR_KEY, mode);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/** 画面の中のミラーの位置と大きさ [CSS px]（左上が原点） */
export interface MirrorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ミラーを置ける範囲 [CSS px]（左右の端と上端。上の左右にあるボタンや地図を避ける） */
export interface MirrorRegion {
  left: number;
  right: number;
  top: number;
}

/**
 * 画面の左右の真ん中にミラーを置くための範囲。left・right（左右の表示を避けた端）のうち
 * 真ん中から近いほうに合わせて、左右対称に狭める
 */
export function centeredRegion(width: number, left: number, right: number, top: number): MirrorRegion {
  const center = width / 2;
  const half = Math.max(0, Math.min(center - left, right - center));
  return { left: Math.round(center - half), right: Math.round(center + half), top };
}

/**
 * ミラーを置く場所。
 * all: 範囲の真ん中に、バックミラーを挟んで左右にサイドミラーを並べる（車の中から前を見たときの並び）。
 * rear: バックミラーだけを真ん中に。side: サイドミラーだけを範囲の左右の端に（真ん中は空ける）
 */
export function mirrorLayout(
  width: number,
  region: MirrorRegion,
  mode: Exclude<MirrorMode, 'off'>,
  portrait = false,
): { rear: MirrorRect; left: MirrorRect; right: MirrorRect } {
  const room = Math.max(0, region.right - region.left);
  const gap = 8;
  if (mode === 'side') {
    const sw = Math.round(Math.min((room - gap) / 2, width * (portrait ? 0.4 : 0.18), 230));
    const h = Math.round(sw / 1.7);
    const left = { x: Math.round(region.left), y: region.top, w: sw, h };
    const right = { x: Math.round(region.right - sw), y: region.top, w: sw, h };
    // バックミラーは出さない（下端を求めるときのために、高さだけ揃えておく）
    return { rear: { x: left.x + sw, y: region.top, w: 0, h }, left, right };
  }
  const withSides = mode === 'all';
  // 縦向きの画面は幅が狭いので、横幅に対して大きめにとる
  const share = withSides ? (portrait ? 0.94 : 0.6) : portrait ? 0.72 : 0.42;
  const total = Math.min(room, width * share, withSides ? 760 : 440);
  const sw = withSides ? Math.round(total * 0.22) : 0;
  const rw = Math.round(withSides ? total - 2 * (sw + gap) : total);
  const h = Math.round(rw / 4);
  const center = (region.left + region.right) / 2;
  const rx = Math.round(center - rw / 2);
  return {
    rear: { x: rx, y: region.top, w: rw, h },
    left: { x: rx - gap - sw, y: region.top, w: sw, h },
    right: { x: rx + rw + gap, y: region.top, w: sw, h },
  };
}

interface Mirror {
  camera: THREE.PerspectiveCamera;
  target: THREE.WebGLRenderTarget;
  /** 車体から見たカメラの位置と、見る先 */
  eye: THREE.Vector3;
  look: THREE.Vector3;
  /** 横の視野 [度] */
  hfov: number;
  /** 映すときに自分の車を隠すか（バックミラーは車の中から見るので隠す） */
  hideCar: boolean;
  frame: HTMLElement;
  rect: MirrorRect | null;
}

/**
 * バックミラー・サイドミラー。後ろ向きのカメラで小さな画像に描き、左右を反転して画面の上に貼る。
 * 画像の更新は1フレームおき（重くならないように）、貼るのは毎フレーム
 */
export class Mirrors {
  private readonly mirrors: { rear: Mirror; left: Mirror; right: Mirror };
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private frameCount = 0;
  private modeValue: MirrorMode;

  constructor(container: HTMLElement, mode: MirrorMode) {
    this.modeValue = mode;
    const make = (cls: string, eye: THREE.Vector3, look: THREE.Vector3, hfov: number, hideCar: boolean): Mirror => {
      const frame = document.createElement('div');
      frame.className = `mirror-frame ${cls} hidden`;
      container.appendChild(frame);
      return {
        camera: new THREE.PerspectiveCamera(20, 2, 0.3, 260),
        target: new THREE.WebGLRenderTarget(4, 4),
        eye,
        look,
        hfov,
        hideCar,
        frame,
        rect: null,
      };
    };
    this.mirrors = {
      rear: make('rear', new THREE.Vector3(0, 1.3, 0.1), new THREE.Vector3(0, 0.9, -30), 54, true),
      // 車体の +X が左（左ハンドルの向きの座標）。左のミラーは左後ろを映す
      left: make('left', new THREE.Vector3(1.05, 1.0, 0.6), new THREE.Vector3(6, 0.6, -30), 40, false),
      right: make('right', new THREE.Vector3(-1.05, 1.0, 0.6), new THREE.Vector3(-6, 0.6, -30), 40, false),
    };
    // 左右を反転して貼る（鏡なので）
    const geo = new THREE.PlaneGeometry(2, 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    this.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false }));
    this.quadScene.add(this.quad);
  }

  get mode(): MirrorMode {
    return this.modeValue;
  }

  set mode(mode: MirrorMode) {
    this.modeValue = mode;
  }

  private active(): Mirror[] {
    const { rear, left, right } = this.mirrors;
    switch (this.modeValue) {
      case 'off':
        return [];
      case 'rear':
        return [rear];
      case 'side':
        return [left, right];
      case 'all':
        return [rear, left, right];
    }
  }

  /** いまの置き方での、ミラーの下端 [CSS px]（走行中の表示をその下に置くため） */
  bottom(region: MirrorRegion): number {
    if (this.modeValue === 'off') return region.top;
    return region.top + mirrorLayout(window.innerWidth, region, this.modeValue, window.innerHeight > window.innerWidth).rear.h;
  }

  /**
   * 毎フレーム、ふつうの描画の後に呼ぶ。show が false（メニューを開いている間など）なら出さない。
   * region はミラーを置ける範囲
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, car: THREE.Object3D, show: boolean, region: MirrorRegion): void {
    const active = show ? this.active() : [];
    for (const m of Object.values(this.mirrors)) m.frame.classList.toggle('hidden', !active.includes(m));
    if (active.length === 0 || this.modeValue === 'off') return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const layout = mirrorLayout(width, region, this.modeValue, height > width);
    const pixelRatio = Math.min(renderer.getPixelRatio(), 1.5);
    const update = this.frameCount++ % 2 === 0;
    car.updateMatrixWorld();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const prevTarget = renderer.getRenderTarget();
    for (const [key, m] of Object.entries(this.mirrors) as [keyof typeof layout, Mirror][]) {
      if (!active.includes(m)) continue;
      const rect = layout[key];
      if (!m.rect || m.rect.x !== rect.x || m.rect.y !== rect.y || m.rect.w !== rect.w || m.rect.h !== rect.h) {
        m.rect = rect;
        Object.assign(m.frame.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
        m.target.setSize(Math.max(4, Math.round(rect.w * pixelRatio)), Math.max(4, Math.round(rect.h * pixelRatio)));
        m.camera.aspect = rect.w / rect.h;
        const hfov = THREE.MathUtils.degToRad(m.hfov);
        m.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / m.camera.aspect));
        m.camera.updateProjectionMatrix();
      }
      if (!update) continue;
      m.camera.position.copy(car.localToWorld(m.eye.clone()));
      m.camera.up.set(0, 1, 0);
      m.camera.lookAt(car.localToWorld(m.look.clone()));
      const carVisible = car.visible;
      if (m.hideCar) car.visible = false;
      // 影はふつうの描画で作ったものを使い回す
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(m.target);
      renderer.render(scene, m.camera);
      renderer.shadowMap.autoUpdate = shadowAuto;
      car.visible = carVisible;
    }
    renderer.setRenderTarget(prevTarget);
    // 画面に貼る
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    for (const m of active) {
      const r = m.rect!;
      const y = height - r.y - r.h;
      renderer.setViewport(r.x, y, r.w, r.h);
      renderer.setScissor(r.x, y, r.w, r.h);
      this.quad.material.map = m.target.texture;
      renderer.render(this.quadScene, this.quadCamera);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.autoClear = autoClear;
  }
}
