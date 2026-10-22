import { type ParsedMap, type SignType, DIR_OFFSET, DIR_YAW, roadShape, tileCenter } from './tilemap';

/**
 * マップから障害物の配置を求める。物理（衝突体）と描画（メッシュ）の両方がこの結果を使う。
 */

export interface BoxObstacle {
  kind: 'building' | 'wall' | 'guardrail';
  /** 中心座標 */
  x: number;
  y: number;
  z: number;
  /** 半分の大きさ */
  hx: number;
  hy: number;
  hz: number;
  /** Y軸回りの回転 [rad]（省略時は 0） */
  yaw?: number;
  /** 見た目用の色番号 */
  variant: number;
}

export interface TreeObstacle {
  x: number;
  z: number;
  trunkRadius: number;
  height: number;
}

export interface ConeProp {
  x: number;
  z: number;
}

export interface SignObstacle {
  x: number;
  z: number;
  yaw: number;
  type: SignType;
}

export interface MapObstacles {
  boxes: BoxObstacle[];
  trees: TreeObstacle[];
  cones: ConeProp[];
  signs: SignObstacle[];
}

/** タイル座標から決まる 0..1 の疑似乱数（見た目のばらつき用、毎回同じ結果になる） */
export function tileHash(col: number, row: number, salt = 0): number {
  let h = (col * 374761393 + row * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 1;
const GUARDRAIL_SEGMENTS = 6;
const GUARDRAIL_HEIGHT = 0.8;

export function buildObstacles(map: ParsedMap): MapObstacles {
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const rw = roadWidth / 2;
  const boxes: BoxObstacle[] = [];
  const trees: TreeObstacle[] = [];
  const cones: ConeProp[] = [];
  const signs: SignObstacle[] = [];

  for (const tile of map.tiles) {
    const { x, z } = tileCenter(map, tile.col, tile.row);
    if (tile.kind === 'building') {
      const height = 6 + Math.floor(tileHash(tile.col, tile.row) * 4) * 4;
      const size = half - 2;
      boxes.push({
        kind: 'building',
        x,
        y: height / 2,
        z,
        hx: size,
        hy: height / 2,
        hz: size,
        variant: Math.floor(tileHash(tile.col, tile.row, 1) * 4),
      });
    } else if (tile.kind === 'tree') {
      trees.push({ x, z, trunkRadius: 0.5, height: 6 + tileHash(tile.col, tile.row) * 3 });
    } else if (tile.kind === 'road' && tile.cones) {
      // 道路の向きに沿って、車線をふさぐように千鳥配置
      const alongX = tile.connections.includes('E') || tile.connections.includes('W');
      const offsets = [
        [-6, -2.5],
        [0, 2.5],
        [6, -2.5],
      ];
      for (const [a, b] of offsets) {
        cones.push(alongX ? { x: x + a, z: z + b } : { x: x + b, z: z + a });
      }
    }
  }

  if (map.def.guardrails) {
    for (const tile of map.tiles) {
      if (tile.kind !== 'road' || roadShape(tile) !== 'curve') continue;
      boxes.push(...curveGuardrail(map, tile.col, tile.row, tile.connections, half + rw + 0.8));
    }
    // 行き止まり（一本道のコースの端）は、道路の端をガードレールでふさぐ
    for (const tile of map.tiles) {
      if (tile.kind !== 'road' || roadShape(tile) !== 'deadEnd') continue;
      const { x, z } = tileCenter(map, tile.col, tile.row);
      const back = DIR_OFFSET[tile.connections[0]];
      const d = rw + 1;
      boxes.push({
        kind: 'guardrail',
        x: x - back.dc * d,
        y: GUARDRAIL_HEIGHT / 2,
        z: z - back.dr * d,
        hx: 0.15,
        hy: GUARDRAIL_HEIGHT / 2,
        hz: rw + 1,
        // ガードレールは長さがローカル +Z。道路を横切る向きにする
        yaw: back.dc !== 0 ? 0 : Math.PI / 2,
        variant: 0,
      });
    }
  }

  for (const sign of map.def.signs ?? []) {
    const { x, z } = tileCenter(map, sign.col, sign.row);
    const d = rw + 1.2;
    signs.push({
      x: x + (sign.corner.includes('E') ? d : -d),
      z: z + (sign.corner.includes('S') ? d : -d),
      yaw: DIR_YAW[sign.facing],
      type: sign.type,
    });
  }

  // マップ外周の壁
  const minX = -half;
  const maxX = (map.cols - 1) * tileSize + half;
  const minZ = -half;
  const maxZ = (map.rows - 1) * tileSize + half;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const w = (maxX - minX) / 2;
  const d = (maxZ - minZ) / 2;
  const t = WALL_THICKNESS / 2;
  const hy = WALL_HEIGHT;
  boxes.push(
    { kind: 'wall', x: cx, y: hy, z: minZ - t, hx: w + 2 * t, hy, hz: t, variant: 1 },
    { kind: 'wall', x: cx, y: hy, z: maxZ + t, hx: w + 2 * t, hy, hz: t, variant: 1 },
    { kind: 'wall', x: minX - t, y: hy, z: cz, hx: t, hy, hz: d, variant: 1 },
    { kind: 'wall', x: maxX + t, y: hy, z: cz, hx: t, hy, hz: d, variant: 1 },
  );

  return { boxes, trees, cones, signs };
}

/** カーブの外周に沿って、短い直線のガードレールを並べる */
function curveGuardrail(
  map: ParsedMap,
  col: number,
  row: number,
  connections: string[],
  radius: number,
): BoxObstacle[] {
  const half = map.def.tileSize / 2;
  const { x, z } = tileCenter(map, col, row);
  // 円弧の中心はタイルの角（つながっている2方向の間）
  const sx = connections.includes('E') ? 1 : -1;
  const sz = connections.includes('S') ? 1 : -1;
  const cx = x + sx * half;
  const cz = z + sz * half;
  const step = Math.PI / 2 / GUARDRAIL_SEGMENTS;
  const halfLength = radius * Math.sin(step / 2);
  const result: BoxObstacle[] = [];
  for (let i = 0; i < GUARDRAIL_SEGMENTS; i++) {
    const phi = (i + 0.5) * step;
    // 角から見て (-sx, 0) 方向から (0, -sz) 方向へ回る
    const dx = -sx * Math.cos(phi);
    const dz = -sz * Math.sin(phi);
    const tx = sx * Math.sin(phi);
    const tz = -sz * Math.cos(phi);
    const r = radius * Math.cos(step / 2);
    result.push({
      kind: 'guardrail',
      x: cx + dx * r,
      y: GUARDRAIL_HEIGHT / 2,
      z: cz + dz * r,
      hx: 0.15,
      hy: GUARDRAIL_HEIGHT / 2,
      hz: halfLength,
      yaw: Math.atan2(tx, tz),
      variant: 0,
    });
  }
  return result;
}
