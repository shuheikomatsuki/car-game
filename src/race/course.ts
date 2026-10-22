import {
  DIR_OFFSET,
  DIR_YAW,
  type Direction,
  type ParsedMap,
  tileCenter,
} from '../map/tilemap';

const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export interface CourseTile {
  col: number;
  row: number;
  /** このタイルから次のタイルへ出ていく方向 */
  exit: Direction;
}

/**
 * レース用の周回コース。スタートのタイルから進行方向へ道路をたどった一周分のタイルの並び。
 * スタートラインはスタートのタイルの入口（1つ前のタイルとの境目）に引く。
 */
export interface Course {
  map: ParsedMap;
  /** tiles[0] がスタートのタイル */
  tiles: CourseTile[];
  /** スタートラインの中心と、進行方向のヨー角 */
  line: { x: number; z: number; yaw: number };
  /** その位置のタイルが一周の何番目か（コース外なら -1） */
  indexAt(x: number, z: number): number;
  /** その番目のタイルでの進行方向（単位ベクトル） */
  directionAt(index: number): { x: number; z: number };
  /** スタートラインの手前に並ぶ位置。back はラインからの距離、side は左方向へのずれ [m] */
  gridSpot(back: number, side?: number): { x: number; z: number; yaw: number };
}

/** 方向の単位ベクトル（+X が東、+Z が南） */
function vec(d: Direction): { x: number; z: number } {
  const { dc, dr } = DIR_OFFSET[d];
  return { x: dc, z: dr };
}

/**
 * マップのスタート地点から一周をたどってコースを作る。
 * 一周の途中に交差点があったり、スタートが直線でなかったりするとエラーにする。
 */
export function buildCourse(map: ParsedMap): Course {
  const { start, tileSize } = map.def;
  const first = map.tileAt(start.col, start.row)!;
  const heading = start.heading;
  if (!first.connections.includes(heading) || !first.connections.includes(OPPOSITE[heading]) || first.connections.length !== 2) {
    throw new Error('The start of a course must be on a straight road');
  }

  const tiles: CourseTile[] = [];
  const indexByKey = new Map<string, number>();
  let tile = first;
  let exit: Direction = heading;
  for (;;) {
    const key = `${tile.col},${tile.row}`;
    if (indexByKey.has(key)) throw new Error(`The course crosses itself at (${tile.col}, ${tile.row})`);
    indexByKey.set(key, tiles.length);
    tiles.push({ col: tile.col, row: tile.row, exit });
    const { dc, dr } = DIR_OFFSET[exit];
    const next = map.tileAt(tile.col + dc, tile.row + dr);
    if (!next || next.kind !== 'road') throw new Error(`The course is broken at (${tile.col}, ${tile.row})`);
    if (next === first) break;
    if (next.connections.length !== 2) throw new Error(`The course has a junction at (${next.col}, ${next.row})`);
    const from = OPPOSITE[exit];
    exit = next.connections.find((d) => d !== from)!;
    tile = next;
  }

  const center = tileCenter(map, first.col, first.row);
  const forward = vec(heading);
  const yaw = DIR_YAW[heading];
  const line = { x: center.x - (forward.x * tileSize) / 2, z: center.z - (forward.z * tileSize) / 2, yaw };

  return {
    map,
    tiles,
    line,
    indexAt(x, z) {
      const col = Math.round(x / tileSize);
      const row = Math.round(z / tileSize);
      return indexByKey.get(`${col},${row}`) ?? -1;
    },
    directionAt(index) {
      // カーブでは入ってきた向きと出ていく向きの中間を進行方向とみなす
      const t = tiles[index];
      const prev = tiles[(index - 1 + tiles.length) % tiles.length];
      const a = vec(prev.exit);
      const b = vec(t.exit);
      const x = a.x + b.x;
      const z = a.z + b.z;
      const len = Math.hypot(x, z);
      return { x: x / len, z: z / len };
    },
    gridSpot(back, side = 0) {
      // 左方向 = (forward.z, -forward.x)（+Y 上から見て反時計回りに90°）
      return {
        x: line.x - forward.x * back + forward.z * side,
        z: line.z - forward.z * back - forward.x * side,
        yaw,
      };
    },
  };
}
