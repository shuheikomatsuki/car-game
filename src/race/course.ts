import {
  DIR_OFFSET,
  DIR_YAW,
  type Direction,
  type ParsedMap,
  type Tile,
  tileCenter,
} from '../map/tilemap';

const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export interface CourseTile {
  col: number;
  row: number;
  /** このタイルに入ってくる向き（進行方向） */
  entry: Direction;
  /** このタイルから次のタイルへ出ていく方向 */
  exit: Direction;
}

/** コースの中心線上の点 */
export interface CoursePoint {
  x: number;
  z: number;
  /** 進行方向のヨー角 */
  yaw: number;
  /** 曲率 [1/m]（左カーブが正） */
  curvature: number;
}

export interface CourseProjection {
  /** スタートラインからの中心線に沿った距離 [m] */
  s: number;
  /** 中心線からの左方向へのずれ [m] */
  offset: number;
  /** いるタイルの番号 */
  index: number;
}

/**
 * レース用のコース。スタートのタイルから進行方向へ道路をたどったタイルの並び。
 * 周回コース（closed）は一周でスタートに戻り、そうでないコース（ヒルクライムなど）は行き止まりで終わる。
 * スタートラインはスタートのタイルの入口（1つ前のタイルとの境目）に引く。
 */
export interface Course {
  map: ParsedMap;
  /** tiles[0] がスタートのタイル */
  tiles: CourseTile[];
  closed: boolean;
  /** ゴールラインがあるタイル（その入口がゴール）。周回コースならスタートと同じ 0 */
  finishIndex: number;
  /** スタートラインの中心と、進行方向のヨー角 */
  line: { x: number; z: number; yaw: number };
  /** ゴールラインの中心と向き（周回コースならスタートラインと同じ） */
  finishLine: { x: number; z: number; yaw: number };
  /** 中心線の長さ [m]。周回コースは一周、そうでなければゴールまで */
  length: number;
  /** その位置のタイルがコースの何番目か（コース外なら -1） */
  indexAt(x: number, z: number): number;
  /** その番目のタイルでの進行方向（単位ベクトル） */
  directionAt(index: number): { x: number; z: number };
  /** スタートラインから中心線に沿って s [m] 進んだ点 */
  pointAt(s: number): CoursePoint;
  /** 位置を中心線に投影する */
  project(x: number, z: number): CourseProjection;
  /** スタートラインの手前に並ぶ位置。back はラインからの距離、side は左方向へのずれ [m] */
  gridSpot(back: number, side?: number): { x: number; z: number; yaw: number };
}

/** 方向の単位ベクトル（+X が東、+Z が南） */
function vec(d: Direction): { x: number; z: number } {
  const { dc, dr } = DIR_OFFSET[d];
  return { x: dc, z: dr };
}

export interface RoadWalk {
  tiles: CourseTile[];
  /** 最初のタイルに戻ってきた（周回） */
  closed: boolean;
}

/**
 * first から heading の向きへ道路をたどる。最初のタイルに戻るか、行き止まりに着いたら終わる。
 * 途中に交差点があったり、道が切れていたりするとエラーにする。
 */
export function walkRoad(map: ParsedMap, first: Tile, heading: Direction): RoadWalk {
  const tiles: CourseTile[] = [];
  const seen = new Set<string>();
  let tile = first;
  let entry = heading;
  let exit: Direction = heading;
  for (;;) {
    const key = `${tile.col},${tile.row}`;
    if (seen.has(key)) throw new Error(`The course crosses itself at (${tile.col}, ${tile.row})`);
    seen.add(key);
    tiles.push({ col: tile.col, row: tile.row, entry, exit });
    const { dc, dr } = DIR_OFFSET[exit];
    const next = map.tileAt(tile.col + dc, tile.row + dr);
    if (!next || next.kind !== 'road') throw new Error(`The course is broken at (${tile.col}, ${tile.row})`);
    if (next === first) return { tiles, closed: true };
    const from = OPPOSITE[exit];
    if (next.connections.length === 1) {
      // 行き止まり: まっすぐ抜ける向きで終わる
      tiles.push({ col: next.col, row: next.row, entry: exit, exit });
      return { tiles, closed: false };
    }
    if (next.connections.length !== 2) throw new Error(`The course has a junction at (${next.col}, ${next.row})`);
    entry = exit;
    exit = next.connections.find((d) => d !== from)!;
    tile = next;
  }
}

/** タイル1枚分の中心線の形 */
interface Segment {
  /** 入口の中心 */
  ex: number;
  ez: number;
  a: { x: number; z: number };
  b: { x: number; z: number };
  curve: boolean;
  /** 長さ [m] */
  length: number;
  /** スタートラインからの、このタイルの入口までの距離 */
  start: number;
  /** 左カーブなら 1、右カーブなら -1 */
  turn: number;
}

/**
 * 中心線のタイル1枚分。直線は入口から出口へ、カーブはタイルの角を中心とする 1/4 円。
 * a = 入ってくる向き、b = 出ていく向き。
 */
function makeSegment(map: ParsedMap, t: CourseTile, start: number): Segment {
  const half = map.def.tileSize / 2;
  const c = tileCenter(map, t.col, t.row);
  const a = vec(t.entry);
  const b = vec(t.exit);
  const curve = a.x !== b.x || a.z !== b.z;
  // 左 = (a.z, -a.x)。出ていく向きが左なら左カーブ
  const turn = curve ? (b.x * a.z - b.z * a.x > 0 ? 1 : -1) : 0;
  return {
    ex: c.x - a.x * half,
    ez: c.z - a.z * half,
    a,
    b,
    curve,
    length: curve ? (Math.PI / 2) * half : 2 * half,
    start,
    turn,
  };
}

function segmentPoint(seg: Segment, u: number, half: number): CoursePoint {
  const { a, b } = seg;
  if (!seg.curve) {
    return { x: seg.ex + a.x * u, z: seg.ez + a.z * u, yaw: Math.atan2(a.x, a.z), curvature: 0 };
  }
  // 角 C = 入口 + b * half。C から見て -b の向きから a の向きへ回る
  const th = u / half;
  const cx = seg.ex + b.x * half;
  const cz = seg.ez + b.z * half;
  const x = cx + half * (-b.x * Math.cos(th) + a.x * Math.sin(th));
  const z = cz + half * (-b.z * Math.cos(th) + a.z * Math.sin(th));
  const tx = b.x * Math.sin(th) + a.x * Math.cos(th);
  const tz = b.z * Math.sin(th) + a.z * Math.cos(th);
  return { x, z, yaw: Math.atan2(tx, tz), curvature: seg.turn / half };
}

/** タイル内での投影（u = 入口からの距離、offset = 左へのずれ）。u はタイルの範囲に収める */
function segmentProject(seg: Segment, x: number, z: number, half: number): { u: number; offset: number; dist: number } {
  let u: number;
  if (!seg.curve) {
    u = (x - seg.ex) * seg.a.x + (z - seg.ez) * seg.a.z;
  } else {
    const cx = seg.ex + seg.b.x * half;
    const cz = seg.ez + seg.b.z * half;
    const vx = x - cx;
    const vz = z - cz;
    const th = Math.atan2(vx * seg.a.x + vz * seg.a.z, -(vx * seg.b.x + vz * seg.b.z));
    u = th * half;
  }
  u = Math.min(seg.length, Math.max(0, u));
  const p = segmentPoint(seg, u, half);
  const lx = Math.cos(p.yaw);
  const lz = -Math.sin(p.yaw);
  const offset = (x - p.x) * lx + (z - p.z) * lz;
  return { u, offset, dist: Math.hypot(x - p.x, z - p.z) };
}

/**
 * マップのスタート地点からコースを作る。スタートは直線でなければならない。
 * 一周してスタートに戻れば周回コース、行き止まりに着けばそこまでの一本道のコースになる。
 * 一本道のコースでは、最後の2枚は止まるための区間として残し、その手前をゴールにする。
 */
export function buildCourse(map: ParsedMap): Course {
  const { start, tileSize } = map.def;
  const half = tileSize / 2;
  const first = map.tileAt(start.col, start.row)!;
  const heading = start.heading;
  if (!first.connections.includes(heading) || !first.connections.includes(OPPOSITE[heading]) || first.connections.length !== 2) {
    throw new Error('The start of a course must be on a straight road');
  }

  const { tiles, closed } = walkRoad(map, first, heading);
  if (!closed && tiles.length < 4) throw new Error('A point-to-point course is too short');
  const indexByKey = new Map<string, number>();
  tiles.forEach((t, i) => indexByKey.set(`${t.col},${t.row}`, i));

  const segments: Segment[] = [];
  let total = 0;
  for (const t of tiles) {
    const seg = makeSegment(map, t, total);
    segments.push(seg);
    total += seg.length;
  }
  const finishIndex = closed ? 0 : tiles.length - 2;
  const length = closed ? total : segments[finishIndex].start;

  const yaw = DIR_YAW[heading];
  const forward = vec(heading);
  const line = { x: segments[0].ex, z: segments[0].ez, yaw };
  const fin = segments[finishIndex];
  const finishLine = { x: fin.ex, z: fin.ez, yaw: Math.atan2(fin.a.x, fin.a.z) };

  const indexAt = (x: number, z: number) => indexByKey.get(`${Math.round(x / tileSize)},${Math.round(z / tileSize)}`) ?? -1;

  const project = (x: number, z: number): CourseProjection => {
    const index = indexAt(x, z);
    if (index >= 0) {
      const p = segmentProject(segments[index], x, z, half);
      return { s: segments[index].start + p.u, offset: p.offset, index };
    }
    // コースの外（草地など）では、いちばん近いタイルに投影する
    let best = { s: 0, offset: 0, index: 0 };
    let bestDist = Infinity;
    segments.forEach((seg, i) => {
      const p = segmentProject(seg, x, z, half);
      if (p.dist < bestDist) {
        bestDist = p.dist;
        best = { s: seg.start + p.u, offset: p.offset, index: i };
      }
    });
    return best;
  };

  return {
    map,
    tiles,
    closed,
    finishIndex,
    line,
    finishLine,
    length,
    indexAt,
    directionAt(index) {
      // カーブでは入ってきた向きと出ていく向きの中間を進行方向とみなす
      const t = tiles[Math.max(0, index)];
      const a = vec(t.entry);
      const b = vec(t.exit);
      const x = a.x + b.x;
      const z = a.z + b.z;
      const len = Math.hypot(x, z);
      return { x: x / len, z: z / len };
    },
    pointAt(s) {
      let d = closed ? ((s % total) + total) % total : Math.min(total, Math.max(0, s));
      // 二分探索でタイルを探す
      let lo = 0;
      let hi = segments.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segments[mid].start <= d) lo = mid;
        else hi = mid - 1;
      }
      const seg = segments[lo];
      d -= seg.start;
      return segmentPoint(seg, Math.min(d, seg.length), half);
    },
    project,
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

/** 道路の中心線を step [m] ごとに区切った点の並び（地形の高さを道路に沿わせるのに使う） */
export function roadCenterline(map: ParsedMap, first: Tile, heading: Direction, step: number): { points: { x: number; z: number; s: number }[]; length: number } {
  const half = map.def.tileSize / 2;
  const { tiles } = walkRoad(map, first, heading);
  const points: { x: number; z: number; s: number }[] = [];
  let start = 0;
  tiles.forEach((t, i) => {
    const seg = makeSegment(map, t, start);
    // 最後の行き止まりのタイルは道路の端（タイルの中心 + 道幅の半分）まで
    const length = i === tiles.length - 1 && !map.tileAt(t.col, t.row)!.connections.includes(t.exit) ? half + map.def.roadWidth / 2 : seg.length;
    const n = Math.max(1, Math.round(length / step));
    for (let k = 0; k < n; k++) {
      const u = (k / n) * length;
      const p = segmentPoint(seg, u, half);
      points.push({ x: p.x, z: p.z, s: start + u });
    }
    start += length;
  });
  const last = points[points.length - 1];
  return { points, length: Math.max(start, last.s) };
}
