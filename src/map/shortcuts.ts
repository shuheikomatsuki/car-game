import { DIR_OFFSET, type Direction, type ParsedMap, roadShape, tileCenter } from './tilemap';

/**
 * ヘアピンの内側の近道（いろは坂の「インベタのさらにインベタ」）。
 *
 * ヘアピン（同じ側へ曲がる2つのカーブを直線1枚でつないだUターン）の内側に沿って、道路の外に走れる帯を作る。
 * 帯の上は崖に落ちず、道路と同じように走れる。内側を大きく使えるぶん速く回れるが、
 * 帯の途中には段差があり、下りで飛び込むと少し宙に浮く（浮いている間はハンドルもアクセルも効かない）。
 */
export interface Shortcut {
  /** ヘアピンの直線のタイルの中心 */
  x: number;
  z: number;
  /** 直線の向き（単位ベクトル） */
  ax: number;
  az: number;
  /** 直線から見て内側の向き（単位ベクトル） */
  nx: number;
  nz: number;
  /** 帯の範囲: 直線に沿って -uMax..uMax、内側へ wMin..wMax [m]（直線の中心線から） */
  uMax: number;
  wMin: number;
  wMax: number;
}

/** 帯の幅（直線の道路の端から内側へ）。タイルの大きさに対する割合 */
const WIDTH_RATIO = 0.45;

/** マップの中のヘアピンを探して、内側の近道の帯を作る */
export function findShortcuts(map: ParsedMap): Shortcut[] {
  const { tileSize, roadWidth } = map.def;
  const rw = roadWidth / 2;
  const result: Shortcut[] = [];
  for (const tile of map.tiles) {
    if (tile.kind !== 'road' || roadShape(tile) !== 'straight') continue;
    const [d1, d2] = tile.connections;
    const a = map.tileAt(tile.col + DIR_OFFSET[d1].dc, tile.row + DIR_OFFSET[d1].dr)!;
    const b = map.tileAt(tile.col + DIR_OFFSET[d2].dc, tile.row + DIR_OFFSET[d2].dr)!;
    if (roadShape(a) !== 'curve' || roadShape(b) !== 'curve') continue;
    // 両端のカーブが同じ側へ曲がっていればヘアピン。その側が内側
    const sideA = a.connections.find((d) => d !== opposite(d1));
    const sideB = b.connections.find((d) => d !== opposite(d2));
    if (!sideA || sideA !== sideB) continue;
    const c = tileCenter(map, tile.col, tile.row);
    const along = DIR_OFFSET[d2];
    const inner = DIR_OFFSET[sideA];
    result.push({
      x: c.x,
      z: c.z,
      ax: along.dc,
      az: along.dr,
      nx: inner.dc,
      nz: inner.dr,
      uMax: tileSize - rw + 2,
      wMin: rw - 1,
      wMax: rw + WIDTH_RATIO * tileSize,
    });
  }
  return result;
}

function opposite(d: Direction): Direction {
  return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[d];
}

/** 帯から見た位置（u = 直線に沿った位置、w = 内側への距離） */
export function shortcutLocal(sc: Shortcut, x: number, z: number): { u: number; w: number } {
  const dx = x - sc.x;
  const dz = z - sc.z;
  return { u: dx * sc.ax + dz * sc.az, w: dx * sc.nx + dz * sc.nz };
}

export function insideShortcut(sc: Shortcut, x: number, z: number): boolean {
  const { u, w } = shortcutLocal(sc, x, z);
  return Math.abs(u) <= sc.uMax && w >= sc.wMin && w <= sc.wMax;
}

/** 帯の上の点のワールド座標 */
export function shortcutPoint(sc: Shortcut, u: number, w: number): { x: number; z: number } {
  return { x: sc.x + sc.ax * u + sc.nx * w, z: sc.z + sc.az * u + sc.nz * w };
}

/** 段差の位置（高い側の端から、帯の長さに対する割合） */
const STEP_AT = 0.3;
/** 段差までに下がる割合（帯の両端の高低差に対する） */
const BEFORE_STEP = 0.1;
/** 段差の高さ [m]（両端の高低差の 3 割までに抑える） */
const STEP_HEIGHT = 2.2;

/**
 * 帯の上の高さ。両端（道路につながる所）の高さ high・low の間を、途中に段差をはさんで下る。
 * t は高い側の端から低い側の端まで 0..1
 */
export function shortcutHeight(t: number, high: number, low: number): number {
  const drop = high - low;
  const step = Math.min(STEP_HEIGHT, 0.3 * Math.max(0, drop));
  const before = BEFORE_STEP * drop;
  if (t < STEP_AT) return high - (before * t) / STEP_AT;
  return high - before - step - ((drop - before - step) * (t - STEP_AT)) / (1 - STEP_AT);
}
