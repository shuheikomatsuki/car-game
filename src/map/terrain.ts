import { roadCenterline } from '../race/course';
import type { ParsedMap } from './tilemap';

/** 地形を計算する格子の間隔 [m] */
const GRID_STEP = 4;
/** マップの外側にも地形を広げる幅 [m] */
const MARGIN = 160;

/**
 * 高低差のある地形。道路に沿って高さが決まり、道路から離れた場所は周りの道路の高さをなめらかにつなぐ。
 *
 * 物理（衝突）は平らなまま計算し、見た目の高さと、坂道で車にかかる重力だけをこの地形から求める。
 */
export interface Terrain {
  /** 地面（道路）の高さ [m] */
  heightAt(x: number, z: number): number;
  /** 高さの勾配（x・z 方向にそれぞれ 1m 進んだときに上がる高さ） */
  gradientAt(x: number, z: number): { x: number; z: number };
  /** 地形の格子（描画用）。ground は道路の下を少し下げた高さ */
  grid: { minX: number; minZ: number; step: number; nx: number; nz: number; ground: Float32Array };
}

/**
 * 道路をスタートからの距離 t（0..1）で上る高さ。平均の勾配は一定にしつつ、
 * 急な区間とゆるい区間が交互に来るように波を足す（常に上り続ける）。
 */
export function elevationProfile(t: number, rise: number): number {
  const waves = 3;
  const k = 0.55;
  const w = 2 * Math.PI * waves;
  return rise * (t - (k * Math.sin(w * t)) / w);
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function buildTerrain(map: ParsedMap): Terrain | null {
  const spec = map.def.elevation;
  if (!spec) return null;
  const from = map.tileAt(spec.from.col, spec.from.row);
  if (!from || from.kind !== 'road' || from.connections.length !== 1) {
    throw new Error('The elevation must start from a dead end of the road');
  }
  const { points, length } = roadCenterline(map, from, from.connections[0], GRID_STEP);
  const heights = points.map((p) => elevationProfile(p.s / length, spec.rise));

  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const minX = -half - MARGIN;
  const minZ = -half - MARGIN;
  const nx = Math.ceil((map.cols * tileSize + 2 * MARGIN) / GRID_STEP) + 1;
  const nz = Math.ceil((map.rows * tileSize + 2 * MARGIN) / GRID_STEP) + 1;
  const surface = new Float32Array(nx * nz);
  const ground = new Float32Array(nx * nz);
  const rw = roadWidth / 2;
  const px = Float64Array.from(points, (p) => p.x);
  const pz = Float64Array.from(points, (p) => p.z);

  /** 点の間隔で高さが段々にならないよう、近い点の前後の区間に投影して高さを補間する */
  const interpolateAlong = (k: number, x: number, z: number): number => {
    let bestD = Infinity;
    let bestH = heights[k];
    for (const [a, b] of [
      [k - 1, k],
      [k, k + 1],
    ]) {
      if (a < 0 || b >= px.length) continue;
      const sx = px[b] - px[a];
      const sz = pz[b] - pz[a];
      const len2 = sx * sx + sz * sz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - px[a]) * sx + (z - pz[a]) * sz) / len2)) : 0;
      const dx = x - (px[a] + sx * t);
      const dz = z - (pz[a] + sz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        bestH = heights[a] + (heights[b] - heights[a]) * t;
      }
    }
    return bestH;
  };

  for (let j = 0; j < nz; j++) {
    const z = minZ + j * GRID_STEP;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * GRID_STEP;
      let nearest = Infinity;
      let nearestK = 0;
      let wSum = 0;
      let hSum = 0;
      for (let k = 0; k < px.length; k++) {
        const dx = x - px[k];
        const dz = z - pz[k];
        const d2 = dx * dx + dz * dz;
        if (d2 < nearest) {
          nearest = d2;
          nearestK = k;
        }
        const w = 1 / ((d2 + 25) * (d2 + 25));
        wSum += w;
        hSum += w * heights[k];
      }
      const d = Math.sqrt(nearest);
      const nearestH = interpolateAlong(nearestK, x, z);
      // 道路の上は道路の高さ、離れるほど周りの道路の高さの重み付き平均に近づける
      const t = smoothstep((d - rw - 2) / 30);
      const h = nearestH + (hSum / wSum - nearestH) * t;
      surface[j * nx + i] = h;
      // 道路の面と重ならないよう、道路の下の地面は少し下げる
      ground[j * nx + i] = h - 0.25 * (1 - smoothstep((d - rw) / 3));
    }
  }

  const heightAt = (x: number, z: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - minX) / GRID_STEP));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - minZ) / GRID_STEP));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = surface[j * nx + i];
    const b = surface[j * nx + i + 1];
    const c = surface[(j + 1) * nx + i];
    const e = surface[(j + 1) * nx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };

  return {
    heightAt,
    gradientAt(x, z) {
      const d = 1;
      return {
        x: (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d),
        z: (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d),
      };
    },
    grid: { minX, minZ, step: GRID_STEP, nx, nz, ground },
  };
}
