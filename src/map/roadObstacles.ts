import { BARRIER_HEIGHT, type BoxObstacle, type MapObstacles, type TreeObstacle, tileHash } from './obstacles';
import { FLAG_BRIDGE, FLAG_OLD, FLAG_TUNNEL, LAYER_NONE, PointGrid, type RoadModel } from './road';

/** 壁を区切る長さ [m] */
const WALL_SEGMENT = 4;
const BARRIER_THICKNESS = 0.5;

/**
 * 中心線で描く道路の障害物: 道路の両側の壁（首都高はすべて、峠は橋とトンネル）と、峠の木。
 * 立体交差の所の壁には層（layer）を付け、その層の道路を走る車とだけぶつかるようにする
 */
export function buildRoadObstacles(road: RoadModel): MapObstacles {
  const boxes: BoxObstacle[] = [];
  const highway = road.spec.scenery === 'highway';
  const { step, count } = road;
  const every = Math.round(WALL_SEGMENT / step);
  const segments = road.closed ? count : count - 1;
  for (let i = 0; i < segments; i += every) {
    const j = Math.min(road.closed ? i + every : count - 1, i + every);
    const a = i % count;
    const b = j % count;
    const walled = highway || (road.flags[a] & (FLAG_BRIDGE | FLAG_TUNNEL)) !== 0 || (road.flags[b] & (FLAG_BRIDGE | FLAG_TUNNEL)) !== 0;
    if (!walled) continue;
    const yaw = Math.atan2(road.x[b] - road.x[a], road.z[b] - road.z[a]);
    const mx = (road.x[a] + road.x[b]) / 2;
    const mz = (road.z[a] + road.z[b]) / 2;
    const len = Math.hypot(road.x[b] - road.x[a], road.z[b] - road.z[a]);
    const w = (road.width[a] + road.width[b]) / 2;
    const layer = road.layer[a] || road.layer[b];
    for (const side of [-1, 1]) {
      const off = side * (w / 2 + 0.25 + BARRIER_THICKNESS / 2);
      boxes.push({
        kind: 'barrier',
        // 左 = (cos yaw, -sin yaw)
        x: mx + Math.cos(yaw) * off,
        y: BARRIER_HEIGHT / 2,
        z: mz - Math.sin(yaw) * off,
        hx: BARRIER_THICKNESS / 2,
        hy: BARRIER_HEIGHT / 2,
        // カーブで隙間ができないよう少し長くする
        hz: len / 2 + 0.3,
        yaw,
        variant: 0,
        layer: layer === LAYER_NONE ? undefined : layer,
      });
    }
  }
  return { boxes, trees: highway ? [] : roadTrees(road), cones: [], signs: [] };
}

/**
 * 峠の木。道路の両側の森で、狭い古い道（見通しの悪い区間）は道路のすぐ脇まで木が茂る。
 * 橋の上（谷）・トンネルの上・他の道路の上・U ターンの広場には置かない
 */
function roadTrees(road: RoadModel): TreeObstacle[] {
  const trees: TreeObstacle[] = [];
  const grid = new PointGrid(road.x, road.z);
  const near: number[] = [];
  const turn = road.turnaround;
  /** その点がどの道路の端からも gap [m] より離れているか */
  const clear = (x: number, z: number, gap: number) => {
    near.length = 0;
    grid.near(x, z, 30, near);
    for (const k of near) {
      if (Math.hypot(x - road.x[k], z - road.z[k]) < road.width[k] / 2 + gap) return false;
      if (road.flags[k] & FLAG_BRIDGE && Math.hypot(x - road.x[k], z - road.z[k]) < 40) return false;
    }
    return !(turn && Math.hypot(x - turn.cx, z - turn.cz) < turn.plaza + 4);
  };
  const spacing = 5;
  const every = Math.round(spacing / road.step);
  for (let i = 0; i < road.count; i += every) {
    if (road.flags[i] & (FLAG_BRIDGE | FLAG_TUNNEL)) continue;
    const old = (road.flags[i] & FLAG_OLD) !== 0;
    const yaw = road.yaw[i];
    for (const side of [-1, 1]) {
      // 古い道は手前の列（道路のすぐ脇）にも木がある
      const rows = old ? [2.6, 5.5, 10, 16] : [7, 13, 20];
      rows.forEach((base, r) => {
        const salt = r * 7 + (side > 0 ? 3 : 0);
        if (tileHash(i, salt, 11) > (old ? 0.85 : 0.6)) return;
        const off = side * (road.width[i] / 2 + base + tileHash(i, salt, 12) * 2.5);
        const along = (tileHash(i, salt, 13) - 0.5) * spacing;
        const x = road.x[i] + Math.cos(yaw) * off + Math.sin(yaw) * along;
        const z = road.z[i] - Math.sin(yaw) * off + Math.cos(yaw) * along;
        if (!clear(x, z, base * 0.8)) return;
        trees.push({ x, z, trunkRadius: 0.3, height: 7 + tileHash(i, salt, 14) * 5 });
      });
    }
  }
  return trees;
}
