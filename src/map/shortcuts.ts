import { DIR_OFFSET, type Direction, type ParsedMap, roadShape, tileCenter } from './tilemap';

/**
 * ヘアピンの内側の近道（いろは坂の「インベタのさらにインベタ」）。
 *
 * ヘアピン（同じ側へ曲がる2つのカーブを直線1枚でつないだUターン）の内側、行きと帰りの道路にはさまれた所を
 * 走れる面にする。面の上は崖に落ちず、道路と同じように走れる（コースアウトにもならない）。
 * コーナーの手前で内側へ飛び込めば、道路よりずっと小さく回れる。
 * 面は上の道路の高さから下っていき、下の道路の縁で段差になって終わる。段差から飛び降りると、真下が下の道路
 * （浮いている間はハンドルもアクセルも効かない）。
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
  /** 行きと帰りの道路の内側の縁の位置（直線に沿って ±uEdge） */
  uEdge: number;
  wMin: number;
  wMax: number;
}

/** 面の奥行き（直線の道路の端から内側へ）。タイルの大きさに対する割合 */
const DEPTH_RATIO = 0.95;

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
      uEdge: tileSize - rw,
      wMin: rw - 1,
      wMax: rw + DEPTH_RATIO * tileSize,
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

/** 段差の高さ [m]（上と下の道路の高低差の 8 割までに抑える） */
const STEP_HEIGHT = 2.5;
const STEP_RATIO = 0.8;

/** 段差の高さ [m]。上と下の道路の高低差 drop に対して */
export function shortcutStep(drop: number): number {
  return Math.min(STEP_HEIGHT, STEP_RATIO * Math.max(0, drop));
}

/**
 * 面の上の高さ。t は上の道路の縁（0）から下の道路の縁（1）まで。上の道路の高さ high から下り、
 * 下の道路の縁で段差の高さだけ low より高い所まで来る（その先の段差を降りると下の道路）。
 * 上の道路からはなめらかに入れるよう、初めはゆるく、段差に近づくほど急に下る
 */
export function shortcutHeight(t: number, high: number, low: number): number {
  const drop = high - low;
  const u = Math.min(1, Math.max(0, t));
  return high - (drop - shortcutStep(drop)) * u * u;
}
