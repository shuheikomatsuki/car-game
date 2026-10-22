import { roadCenterline } from '../race/course';
import { type Shortcut, findShortcuts, insideShortcut, shortcutHeight, shortcutLocal, shortcutPoint } from './shortcuts';
import type { ParsedMap } from './tilemap';

/** 地形を計算する格子の間隔 [m] */
const GRID_STEP = 4;
/** マップの外側にも地形を広げる幅 [m] */
const MARGIN = 160;
/**
 * 道路の外の崖。道路の端から CLIFF_START [m] の路肩の先で、CLIFF_WIDTH [m] の間に CLIFF_DEPTH [m] 下がる。
 * 路肩の幅は、道路の上の高さを補間するときに崖の格子点が混ざらない幅（格子の対角線）にしている
 */
export const CLIFF_START = 6;
const CLIFF_WIDTH = 6;
const CLIFF_DEPTH = 10;
/** 道路から離れた場所の高さを求める粗い格子の間隔（GRID_STEP の何倍か） */
const COARSE = 4;
/**
 * 道路の中心線からこれより離れた場所は、道路の高さの影響を受けない（周りの平均の高さの崖の下）[m]。
 * いちばん近い道路の点は、この距離までしか探さない
 */
const REACH = 56;

/**
 * 高低差のある地形。道路に沿って高さが決まり、道路から離れた場所は周りの道路の高さをなめらかにつなぐ。
 *
 * 道路の外は少しの路肩の先が崖になっていて、はみ出すと落ちる（Level.fellOff）。
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
  /** ヘアピンの内側の近道の帯（MapDefinition.shortcuts のときだけ） */
  shortcuts: readonly Shortcut[];
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

/**
 * 道路に沿った高さの形を、等間隔の点の高さ（rise に対する割合）で指定したとき。
 * 点の間はなめらかにつなぐ（点の上で坂がゆるみ、点と点の中ほどが一番急になる）。
 */
export function profileHeight(t: number, rise: number, profile: readonly number[]): number {
  if (profile.length < 2) return rise * (profile[0] ?? 0);
  const x = Math.min(1, Math.max(0, t)) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(x));
  const u = x - i;
  const w = (1 - Math.cos(Math.PI * u)) / 2;
  return rise * (profile[i] + (profile[i + 1] - profile[i]) * w);
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
  const profile = spec.profile;
  const heights = points.map((p) => (profile ? profileHeight(p.s / length, spec.rise, profile) : elevationProfile(p.s / length, spec.rise)));

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

  /** 点の間隔で高さが段々にならないよう、近い点の前後の区間に投影して高さを補間する（d2 はその区間までの距離の2乗） */
  const projectAlong = (k: number, x: number, z: number): { h: number; d2: number } => {
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
    return { h: bestH, d2: bestD };
  };
  const interpolateAlong = (k: number, x: number, z: number) => projectAlong(k, x, z).h;

  /** 道路のいちばん近い所の高さ */
  const roadHeightAt = (x: number, z: number) => {
    let best = Infinity;
    let k = 0;
    for (let i = 0; i < px.length; i++) {
      const d2 = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
      if (d2 < best) {
        best = d2;
        k = i;
      }
    }
    return interpolateAlong(k, x, z);
  };
  // 近道の面: 上の道路の縁から下の道路の縁まで下り、下の道路の縁で段差になる
  const shortcuts = map.def.shortcuts ? findShortcuts(map) : [];
  const shortcutData = shortcuts.map((sc) => {
    // 奥行き 1m ごとの、上と下の道路の縁の高さ
    const ws: number[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    for (let w = sc.wMin; w <= sc.wMax + 1; w += 1) {
      const a = shortcutPoint(sc, -sc.uEdge, w);
      const b = shortcutPoint(sc, sc.uEdge, w);
      ws.push(w);
      starts.push(roadHeightAt(a.x, a.z));
      ends.push(roadHeightAt(b.x, b.z));
    }
    // 直線の向きに進むと下るなら dir = 1
    const mid = Math.floor(ws.length / 2);
    const dir = starts[mid] >= ends[mid] ? 1 : -1;
    // 面の近くの道路の点（いちばん近い点を探す範囲を絞る）
    const near: number[] = [];
    const margin = tileSize;
    for (let k = 0; k < px.length; k++) {
      const { u, w } = shortcutLocal(sc, px[k], pz[k]);
      if (Math.abs(u) <= sc.uMax + margin && w >= -margin && w <= sc.wMax + margin) near.push(k);
    }
    return { starts, ends, dir, near };
  });
  /**
   * 近道の面の上の高さ（面の外なら null）。道路の上は道路の高さ。上の道路からはなめらかにつなぎ、
   * 下の道路との境目は段差にする。lowRamp は下の道路との境目を、道路の端からこの距離だけ面の側へずらす（地形の格子用）
   */
  const shortcutHeightAt = (x: number, z: number, lowRamp = 0): number | null => {
    const i = shortcuts.findIndex((sc) => insideShortcut(sc, x, z));
    if (i < 0) return null;
    const sc = shortcuts[i];
    const { starts, ends, dir, near } = shortcutData[i];
    let bestK = near[0];
    let best = Infinity;
    for (const k of near) {
      const d2 = (x - px[k]) ** 2 + (z - pz[k]) ** 2;
      if (d2 < best) {
        best = d2;
        bestK = k;
      }
    }
    const road = projectAlong(bestK, x, z);
    const d = Math.sqrt(road.d2);
    if (d <= rw) return road.h;
    const { u, w } = shortcutLocal(sc, x, z);
    const fw = Math.min(starts.length - 1.001, Math.max(0, w - sc.wMin));
    const j = Math.floor(fw);
    const f = fw - j;
    const start = starts[j] + (starts[j + 1] - starts[j]) * f;
    const end = ends[j] + (ends[j + 1] - ends[j]) * f;
    const [high, low] = dir > 0 ? [start, end] : [end, start];
    const cut = shortcutHeight((u * dir + sc.uEdge) / (2 * sc.uEdge), high, low);
    // いちばん近い道路が下りの後半（下の道路の側）で、面より低ければ段差
    const lowSide = shortcutLocal(sc, px[bestK], pz[bestK]).u * dir > 0 && road.h < cut;
    if (lowSide) return d > rw + lowRamp ? cut : road.h;
    return road.h + (cut - road.h) * smoothstep((d - rw) / 3);
  };

  // 道路から離れた場所の高さ（周りの道路の高さの重み付き平均）はなめらかなので、粗い格子で求めて補間する
  const cnx = Math.ceil((nx - 1) / COARSE) + 1;
  const cnz = Math.ceil((nz - 1) / COARSE) + 1;
  const average = new Float64Array(cnx * cnz);
  for (let cj = 0; cj < cnz; cj++) {
    const z = minZ + cj * COARSE * GRID_STEP;
    for (let ci = 0; ci < cnx; ci++) {
      const x = minX + ci * COARSE * GRID_STEP;
      let wSum = 0;
      let hSum = 0;
      for (let k = 0; k < px.length; k++) {
        const dx = x - px[k];
        const dz = z - pz[k];
        const d2 = dx * dx + dz * dz;
        const w = 1 / ((d2 + 25) * (d2 + 25));
        wSum += w;
        hSum += w * heights[k];
      }
      average[cj * cnx + ci] = hSum / wSum;
    }
  }
  const averageAt = (i: number, j: number) => {
    const fi = i / COARSE;
    const fj = j / COARSE;
    const ci = Math.min(cnx - 2, Math.floor(fi));
    const cj = Math.min(cnz - 2, Math.floor(fj));
    const u = fi - ci;
    const v = fj - cj;
    const a = average[cj * cnx + ci];
    const b = average[cj * cnx + ci + 1];
    const c = average[(cj + 1) * cnx + ci];
    const e = average[(cj + 1) * cnx + ci + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };
  // それぞれの格子点にいちばん近い道路の点（REACH より遠ければ -1）。道路の点から周りの格子点へ書き込んで求める
  const nearestDist2 = new Float64Array(nx * nz).fill(Infinity);
  const nearestIndex = new Int32Array(nx * nz).fill(-1);
  const reachCells = Math.ceil(REACH / GRID_STEP);
  for (let k = 0; k < px.length; k++) {
    const ci = Math.round((px[k] - minX) / GRID_STEP);
    const cj = Math.round((pz[k] - minZ) / GRID_STEP);
    for (let j = Math.max(0, cj - reachCells); j <= Math.min(nz - 1, cj + reachCells); j++) {
      const dz = minZ + j * GRID_STEP - pz[k];
      for (let i = Math.max(0, ci - reachCells); i <= Math.min(nx - 1, ci + reachCells); i++) {
        const dx = minX + i * GRID_STEP - px[k];
        const d2 = dx * dx + dz * dz;
        const cell = j * nx + i;
        if (d2 < nearestDist2[cell]) {
          nearestDist2[cell] = d2;
          nearestIndex[cell] = k;
        }
      }
    }
  }

  for (let j = 0; j < nz; j++) {
    const z = minZ + j * GRID_STEP;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * GRID_STEP;
      const nearestK = nearestIndex[j * nx + i];
      if (nearestK < 0) {
        // 道路から遠い場所: 周りの平均の高さの崖の下
        surface[j * nx + i] = ground[j * nx + i] = averageAt(i, j) - CLIFF_DEPTH;
        continue;
      }
      const d = Math.sqrt(nearestDist2[j * nx + i]);
      const nearestH = interpolateAlong(nearestK, x, z);
      // 近道の面の上は崖にしない。段差は格子の間隔より細かいので、格子では下の道路の端から少し離してつなぐ
      // （面そのものは buildShortcutMesh が heightAt で細かく描く）
      const cut = shortcuts.length ? shortcutHeightAt(x, z, GRID_STEP) : null;
      if (cut !== null) {
        surface[j * nx + i] = cut;
        ground[j * nx + i] = cut - 0.25 * (1 - smoothstep((d - rw) / 3));
        continue;
      }
      // 道路の上は道路の高さ、離れるほど周りの道路の高さの重み付き平均に近づける
      const t = smoothstep((d - rw - 2) / 30);
      const h = nearestH + (averageAt(i, j) - nearestH) * t - CLIFF_DEPTH * smoothstep((d - rw - CLIFF_START) / CLIFF_WIDTH);
      surface[j * nx + i] = h;
      // 道路の面と重ならないよう、道路の下の地面は少し下げる
      ground[j * nx + i] = h - 0.25 * (1 - smoothstep((d - rw) / 3));
    }
  }

  const gridHeightAt = (x: number, z: number) => {
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

  // 近道の面の上は、段差がはっきり出るよう格子を使わずにその場で求める
  const heightAt = shortcuts.length ? (x: number, z: number) => shortcutHeightAt(x, z) ?? gridHeightAt(x, z) : gridHeightAt;

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
    shortcuts,
  };
}
