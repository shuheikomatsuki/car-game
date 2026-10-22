import { DIR_OFFSET } from '../map/tilemap';
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
    const { cols, rows, def } = course.map;
    const size = def.tileSize;
    // 道路のあるタイルの範囲に合わせる
    let minC = cols;
    let maxC = 0;
    let minR = rows;
    let maxR = 0;
    for (const t of course.tiles) {
      minC = Math.min(minC, t.col);
      maxC = Math.max(maxC, t.col);
      minR = Math.min(minR, t.row);
      maxR = Math.max(maxR, t.row);
    }
    const worldW = (maxC - minC + 1) * size;
    const worldH = (maxR - minR + 1) * size;
    const box = this.container.clientWidth || 160;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 8;
    const fit = (box - pad * 2) / Math.max(worldW, worldH);
    const cssW = Math.round(worldW * fit + pad * 2);
    const cssH = Math.round(worldH * fit + pad * 2);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = cssW * this.pixelRatio;
    this.canvas.height = cssH * this.pixelRatio;
    this.scale = fit * this.pixelRatio;
    this.offsetX = (pad - (minC - 0.5) * size * fit) * this.pixelRatio;
    this.offsetZ = (pad - (minR - 0.5) * size * fit) * this.pixelRatio;

    const bg = document.createElement('canvas');
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const g = bg.getContext('2d')!;
    const half = size / 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      course.tiles.forEach((t, i) => {
        const prev = course.tiles[(i - 1 + course.tiles.length) % course.tiles.length];
        const a = DIR_OFFSET[prev.exit];
        const b = DIR_OFFSET[t.exit];
        const cx = t.col * size;
        const cz = t.row * size;
        const [ex, ez] = this.toCanvas(cx - a.dc * half, cz - a.dr * half);
        const [ox, oz] = this.toCanvas(cx + b.dc * half, cz + b.dr * half);
        if (i === 0) g.moveTo(ex, ez);
        else g.lineTo(ex, ez);
        if (a.dc === b.dc && a.dr === b.dr) {
          g.lineTo(ox, oz);
        } else {
          // カーブは 1/4 円（タイルの中心を角とする円弧）
          const [px, pz] = this.toCanvas(cx, cz);
          g.arcTo(px, pz, ox, oz, half * this.scale);
        }
      });
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.lineWidth = Math.max(4 * this.pixelRatio, def.roadWidth * this.scale + 2 * this.pixelRatio);
    g.stroke();
    path();
    g.strokeStyle = '#4a4e57';
    g.lineWidth = Math.max(2.5 * this.pixelRatio, def.roadWidth * this.scale);
    g.stroke();

    // スタートライン
    const { line } = course;
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
