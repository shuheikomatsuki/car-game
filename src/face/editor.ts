import { type CropView, FACE_GUIDE, clampView, fitView, minScale, zoomAt } from './crop';
import { composeFaceTexture } from './texture';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

const FRAME = 320;
/** ズームのスライダーの段階数（最小倍率〜最大倍率を対数で割る） */
const ZOOM_STEPS = 100;
const MAX_ZOOM = 8;

export interface FaceEditorHandlers {
  /** 決定したとき（null は顔写真をやめたとき） */
  onApply: (texture: HTMLCanvasElement | null) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * 顔写真を選んで、枠に合わせて切り抜く画面。
 * 画像はブラウザの中で処理するだけで、どこにも送信しない。
 */
export class FaceEditor {
  private readonly root = el('face-editor');
  private readonly canvas = el<HTMLCanvasElement>('face-canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly file = el<HTMLInputElement>('face-file');
  private readonly zoom = el<HTMLInputElement>('face-zoom');
  private readonly ok = el<HTMLButtonElement>('face-ok');
  private readonly empty = el('face-empty');
  private image: ImageBitmap | null = null;
  private view: CropView = { scale: 1, x: 0, y: 0 };
  private drag: { id: number; x: number; y: number } | null = null;
  private openValue = false;

  constructor(private readonly handlers: FaceEditorHandlers) {
    this.canvas.width = this.canvas.height = FRAME;
    this.zoom.max = String(ZOOM_STEPS);
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      if (f) void this.load(f);
      this.file.value = '';
    });
    el('face-cancel').addEventListener('click', () => this.close());
    el('face-clear').addEventListener('click', () => {
      this.handlers.onApply(null);
      this.close();
    });
    this.ok.addEventListener('click', () => {
      if (!this.image) return;
      this.handlers.onApply(composeFaceTexture(this.image, this.view, FRAME));
      this.close();
    });
    this.zoom.addEventListener('input', () => {
      if (!this.image) return;
      const min = minScale(this.image.width, this.image.height, FRAME);
      const scale = min * Math.pow(MAX_ZOOM, Number(this.zoom.value) / ZOOM_STEPS);
      this.setView(zoomAt(this.view, scale, FRAME / 2, FRAME / 2));
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.image) return;
      const p = this.toFrame(e);
      this.setView(zoomAt(this.view, this.view.scale * Math.exp(-e.deltaY * 0.0015), p.x, p.y));
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.image) return;
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.toFrame(e);
      this.drag = { id: e.pointerId, ...p };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const p = this.toFrame(e);
      this.setView({ ...this.view, x: this.view.x + p.x - this.drag.x, y: this.view.y + p.y - this.drag.y });
      this.drag = { id: e.pointerId, ...p };
    });
    const endDrag = () => (this.drag = null);
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('keydown', (e) => {
      if (this.openValue && e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  open(): void {
    this.openValue = true;
    this.root.classList.remove('hidden');
    this.draw();
    this.handlers.onOpenChange(true);
  }

  close(): void {
    this.openValue = false;
    this.root.classList.add('hidden');
    // 写真そのものは保持しない（保存するのは切り抜いた結果だけ）
    this.image?.close();
    this.image = null;
    this.handlers.onOpenChange(false);
  }

  /** テストや自動確認用: 画像ファイルを読み込む */
  async load(file: Blob): Promise<void> {
    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      this.image?.close();
      this.image = image;
      this.view = fitView(image.width, image.height, FRAME);
      this.zoom.value = '0';
      this.draw();
    } catch {
      this.empty.textContent = 'この画像は読み込めませんでした。JPEG や PNG の写真を選んでください。';
    }
  }

  private toFrame(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * FRAME, y: ((e.clientY - r.top) / r.height) * FRAME };
  }

  private setView(v: CropView): void {
    if (!this.image) return;
    this.view = clampView(v, this.image.width, this.image.height, FRAME);
    const min = minScale(this.image.width, this.image.height, FRAME);
    this.zoom.value = String(Math.round((Math.log(this.view.scale / min) / Math.log(MAX_ZOOM)) * ZOOM_STEPS));
    this.draw();
  }

  private draw(): void {
    const { ctx } = this;
    const has = this.image !== null;
    this.ok.disabled = !has;
    this.zoom.disabled = !has;
    this.empty.classList.toggle('hidden', has);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, FRAME, FRAME);
    if (!this.image) return;
    ctx.setTransform(this.view.scale, 0, 0, this.view.scale, this.view.x, this.view.y);
    ctx.drawImage(this.image, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 顔の枠の外側を暗くし、枠・目・口の目安線を描く
    const cx = FACE_GUIDE.centerX * FRAME;
    const cy = FACE_GUIDE.centerY * FRAME;
    const rx = FACE_GUIDE.radiusX * FRAME;
    const ry = FACE_GUIDE.radiusY * FRAME;
    ctx.beginPath();
    ctx.rect(0, 0, FRAME, FRAME);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1.5;
    for (const [y, color] of [
      [FACE_GUIDE.eyeY, 'rgba(120,200,255,0.9)'],
      [FACE_GUIDE.mouthY, 'rgba(255,150,180,0.9)'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.8, y * FRAME);
      ctx.lineTo(cx + rx * 0.8, y * FRAME);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}
