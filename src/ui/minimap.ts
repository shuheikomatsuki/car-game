import type { Course } from '../race/course';

export interface MinimapMarker {
  x: number;
  z: number;
  color: string;
  /** 自分の車は大きく、向きの分かる三角で描く */
  yaw?: number;
  size?: number;
}

/** コース全体を上から見た小さな地図。自分・ゴースト・他の車の位置を点で出す */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** コースの形は変わらないので、一度だけ描いておいて毎フレーム貼る */
  private background: HTMLCanvasElement | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetZ = 0;
  private pixelRatio = 1;

  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    container.appendChild(this.canvas);
  }

  /** 表示するコース（null で隠す） */
  setCourse(course: Course | null): void {
    this.container.classList.toggle('hidden', course === null);
    this.background = null;
    if (!course) return;
    const { def } = course.map;
    // 中心線をたどった点の範囲に合わせる
    const step = 4;
    const points = Array.from({ length: Math.ceil(course.length / step) + 1 }, (_, i) => course.pointAt(Math.min(i * step, course.length)));
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    const margin = def.roadWidth;
    const minX = Math.min(...xs) - margin;
    const minZ = Math.min(...zs) - margin;
    const worldW = Math.max(...xs) + margin - minX;
    const worldH = Math.max(...zs) + margin - minZ;
    const box = this.container.clientWidth || 160;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 6;
    const fit = (box - pad * 2) / Math.max(worldW, worldH);
    const cssW = Math.round(worldW * fit + pad * 2);
    const cssH = Math.round(worldH * fit + pad * 2);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = cssW * this.pixelRatio;
    this.canvas.height = cssH * this.pixelRatio;
    this.scale = fit * this.pixelRatio;
    this.offsetX = (pad - minX * fit) * this.pixelRatio;
    this.offsetZ = (pad - minZ * fit) * this.pixelRatio;

    const bg = document.createElement('canvas');
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const g = bg.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      points.forEach((p, i) => {
        const [x, z] = this.toCanvas(p.x, p.z);
        if (i === 0) g.moveTo(x, z);
        else g.lineTo(x, z);
      });
      if (course.closed) g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.lineWidth = Math.max(4 * this.pixelRatio, def.roadWidth * this.scale + 2 * this.pixelRatio);
    g.stroke();
    path();
    g.strokeStyle = '#4a4e57';
    g.lineWidth = Math.max(2.5 * this.pixelRatio, def.roadWidth * this.scale);
    g.stroke();

    // スタートラインとゴールライン
    for (const line of course.closed ? [course.line] : [course.line, course.finishLine]) {
      const lx = Math.cos(line.yaw);
      const lz = -Math.sin(line.yaw);
      const w = def.roadWidth / 2 + 2;
      const [ax, az] = this.toCanvas(line.x + lx * w, line.z + lz * w);
      const [bx, bz] = this.toCanvas(line.x - lx * w, line.z - lz * w);
      g.beginPath();
      g.moveTo(ax, az);
      g.lineTo(bx, bz);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2 * this.pixelRatio;
      g.stroke();
    }
    this.background = bg;
  }

  private toCanvas(x: number, z: number): [number, number] {
    return [x * this.scale + this.offsetX, z * this.scale + this.offsetZ];
  }

  /** 車の位置を描く。後ろの要素ほど上に重なる */
  draw(markers: MinimapMarker[]): void {
    if (!this.background) return;
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.background, 0, 0);
    const pr = this.pixelRatio;
    for (const m of markers) {
      const [x, y] = this.toCanvas(m.x, m.z);
      const r = (m.size ?? 4) * pr;
      g.fillStyle = m.color;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.lineWidth = 1.5 * pr;
      g.beginPath();
      if (m.yaw === undefined) {
        g.arc(x, y, r, 0, Math.PI * 2);
      } else {
        // 前方 (sin yaw, cos yaw)。キャンバスは +Z が下なのでそのまま使える
        const fx = Math.sin(m.yaw);
        const fz = Math.cos(m.yaw);
        g.moveTo(x + fx * r * 1.6, y + fz * r * 1.6);
        g.lineTo(x - fx * r + fz * r, y - fz * r - fx * r);
        g.lineTo(x - fx * r - fz * r, y - fz * r + fx * r);
        g.closePath();
      }
      g.fill();
      g.stroke();
    }
  }
}
