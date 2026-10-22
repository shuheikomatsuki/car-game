import { type ParsedMap, type SignType, DIR_OFFSET, DIR_YAW, roadShape, tileCenter } from './tilemap';

/**
 * マップから障害物の配置を求める。物理（衝突体）と描画（メッシュ）の両方がこの結果を使う。
 */

export interface BoxObstacle {
  /** barrier は橋の欄干・高架の壁・トンネルの壁の下の縁石（コンクリートの低い壁） */
  kind: 'building' | 'wall' | 'guardrail' | 'barrier';
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
/** 橋の欄干・高架の壁の高さと厚さ [m] */
export const BARRIER_HEIGHT = 1.1;
const BARRIER_THICKNESS = 0.5;
/** 高架の壁のカーブを区切る数 */
const BARRIER_SEGMENTS = 8;

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
      // 高架の道路のマップでは、下の街から高架より高くそびえるビルにする
      const depth = map.def.highway?.depth ?? 0;
      const height = depth + (depth ? 4 + Math.floor(tileHash(tile.col, tile.row) * 6) * 5 : 6 + Math.floor(tileHash(tile.col, tile.row) * 4) * 4);
      const size = half - 2;
      boxes.push({
        kind: 'building',
        x,
        y: height / 2 - depth,
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
      // 橋とトンネルの中は両側に壁があるので、ガードレールは置かない
      if (tile.kind !== 'road' || roadShape(tile) !== 'curve' || tile.bridge || tile.tunnel) continue;
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

  if (map.def.highway) {
    // 高架: すべての道路の両側に壁
    for (const tile of map.tiles) {
      if (tile.kind === 'road') boxes.push(...roadsideBarriers(map, tile.col, tile.row, tile.connections));
    }
  } else {
    // 橋の欄干とトンネルの壁
    for (const tile of map.tiles) {
      if (tile.kind === 'road' && (tile.bridge || tile.tunnel)) boxes.push(...roadsideBarriers(map, tile.col, tile.row, tile.connections));
    }
    // 川岸: 水と陸の境目に柵（橋の上は欄干があるので、橋とのあいだには置かない）。峠の川は谷の底なので置かない
    for (const tile of map.def.elevation ? [] : map.tiles) {
      if (tile.kind !== 'water') continue;
      const { x, z } = tileCenter(map, tile.col, tile.row);
      for (const { dc, dr } of Object.values(DIR_OFFSET)) {
        const next = map.tileAt(tile.col + dc, tile.row + dr);
        if (!next || next.kind === 'water' || next.bridge) continue;
        boxes.push({
          kind: 'guardrail',
          x: x + dc * (half - 0.3),
          y: GUARDRAIL_HEIGHT / 2,
          z: z + dr * (half - 0.3),
          hx: 0.15,
          hy: GUARDRAIL_HEIGHT / 2,
          hz: half,
          yaw: dc !== 0 ? 0 : Math.PI / 2,
          variant: 0,
        });
      }
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

/** 道路の両側の低いコンクリートの壁（橋の欄干・高架の壁）。直線は2枚、カーブは内側と外側の円弧に沿って短く区切る */
function roadsideBarriers(map: ParsedMap, col: number, row: number, connections: string[]): BoxObstacle[] {
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const off = roadWidth / 2 + BARRIER_THICKNESS / 2 + 0.3;
  const { x, z } = tileCenter(map, col, row);
  const wall = (bx: number, bz: number, length: number, yaw: number): BoxObstacle => ({
    kind: 'barrier',
    x: bx,
    y: BARRIER_HEIGHT / 2,
    z: bz,
    hx: BARRIER_THICKNESS / 2,
    hy: BARRIER_HEIGHT / 2,
    hz: length / 2,
    yaw,
    variant: 0,
  });
  const ns = connections.includes('N') && connections.includes('S');
  const ew = connections.includes('E') && connections.includes('W');
  if (ns || ew || connections.length !== 2) {
    // 直線（行き止まりなども直線として扱う）
    const alongX = ew || (!ns && (connections.includes('E') || connections.includes('W')));
    return [-1, 1].map((s) => (alongX ? wall(x, z + s * off, tileSize, Math.PI / 2) : wall(x + s * off, z, tileSize, 0)));
  }
  const sx = connections.includes('E') ? 1 : -1;
  const sz = connections.includes('S') ? 1 : -1;
  const cx = x + sx * half;
  const cz = z + sz * half;
  const step = Math.PI / 2 / BARRIER_SEGMENTS;
  const result: BoxObstacle[] = [];
  for (const radius of [half - off, half + off]) {
    // 隙間ができないよう、少し長めにする
    const length = 2 * radius * Math.tan(step / 2) + BARRIER_THICKNESS;
    for (let i = 0; i < BARRIER_SEGMENTS; i++) {
      const phi = (i + 0.5) * step;
      const tx = sx * Math.sin(phi);
      const tz = -sz * Math.cos(phi);
      result.push(wall(cx - sx * Math.cos(phi) * radius, cz - sz * Math.sin(phi) * radius, length, Math.atan2(tx, tz)));
    }
  }
  return result;
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
