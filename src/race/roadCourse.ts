import { PointGrid, type RoadModel } from '../map/road';
import type { ParsedMap } from '../map/tilemap';
import type { Course, CoursePoint, CourseProjection, ProjectHint } from './course';

/** 周回・ゴールを数えるために区切る区間の長さ [m] */
const CHECKPOINT = 10;
/** 手がかりの位置から前後にこの距離 [m] の中だけを探す */
const SEARCH = 50;
/** U ターンの広場の前後この距離 [m] では、行きと帰りの両方を探す（広場でどう向きを変えてもよいように） */
const TURN_SEARCH = 60;
/** 道路の端からこれだけ外までは、コースの上にいるとみなす [m] */
const ON_COURSE_MARGIN = 8;
/** 進む向きと逆向きのコースの点に投影しないよう、距離の2乗に足す量 */
const WRONG_WAY_PENALTY = 2500;
/** 往復でない一本道のコースで、道路の終わりの手前に残す止まるための区間 [m] */
const RUN_OUT = 50;

/** 中心線で描く道路のコース。タイルのコースにはない、道路の高さなどを持つ */
export interface RoadCourse extends Course {
  road: RoadModel;
  /** s での路面の高さ [m] */
  heightAt(s: number): number;
  /** s で進む向きに 1m 進んだときに上がる高さ */
  gradeAt(s: number): number;
  /** s が道路のどこか（道路の始まりからの距離 [m]）。U ターンの輪の中は道路の終わり */
  roadS(s: number): number;
  /** U ターンの広場の中か */
  inPlaza(x: number, z: number): boolean;
}

/**
 * 道路からコースを作る。周回の道路は一周がコース、U ターンのある道路は行きと帰りをつないだ往復がコースで、
 * スタートラインの位置に戻ってきたらゴール（その先の道路の始まりまでが止まるための区間）。
 */
export function buildRoadCourse(map: ParsedMap, road: RoadModel): RoadCourse {
  const { closed, length: L } = road;
  const s0 = road.spec.start;
  const turn = road.turnaround;
  // コースの点（u = 道路の始まりから中心線に沿った距離）
  const xs: number[] = [];
  const zs: number[] = [];
  const yaws: number[] = [];
  const curvs: number[] = [];
  /** その点の道路の上の距離（U ターンの輪の中は -1） */
  const roadOf: number[] = [];
  /** 道路を進む向き（1 = 行き、-1 = 帰り、0 = U ターンの輪） */
  const dirOf: number[] = [];
  const push = (x: number, z: number, yaw: number, k: number, rs: number, d: number) => {
    xs.push(x);
    zs.push(z);
    yaws.push(yaw);
    curvs.push(k);
    roadOf.push(rs);
    dirOf.push(d);
  };
  for (let i = 0; i < road.count; i++) push(road.x[i], road.z[i], road.yaw[i], road.curvature[i], i * road.step, 1);
  let loopLength = 0;
  if (turn) {
    for (let i = 1; i < turn.loop.length - 1; i++) {
      const p = turn.loop[i];
      push(p.x, p.z, p.yaw, p.curvature, -1, 0);
    }
    loopLength = (turn.loop.length - 1) * road.step;
    for (let i = road.count - 1; i >= 0; i--) push(road.x[i], road.z[i], road.yaw[i] + Math.PI, -road.curvature[i], i * road.step, -1);
  }
  const n = xs.length;
  // 点の間隔（U ターンの輪の点もほぼ同じ間隔）
  const du = road.step;
  const total = closed ? L : (n - 1) * du;
  /** 往復のコース: 帰りでスタートラインの位置に戻るまで。U ターンのない一本道は道路の終わりの手前まで */
  const finishU = closed ? s0 + L : turn ? L + loopLength + (L - s0) : L - RUN_OUT;
  const length = finishU - s0;
  const end = closed ? L : total - s0;
  const grid = new PointGrid(xs, zs);

  const wrap = (i: number) => (closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i)));
  const sample = (u: number): CoursePoint => {
    const f = u / du;
    let i0: number;
    let t: number;
    if (closed) {
      const fl = Math.floor(f);
      i0 = ((fl % n) + n) % n;
      t = f - fl;
    } else {
      const c = Math.min(n - 1, Math.max(0, f));
      i0 = Math.min(n - 2, Math.floor(c));
      t = c - i0;
    }
    const i1 = wrap(i0 + 1);
    let dy = yaws[i1] - yaws[i0];
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { x: xs[i0] + (xs[i1] - xs[i0]) * t, z: zs[i0] + (zs[i1] - zs[i0]) * t, yaw: yaws[i0] + dy * t, curvature: curvs[t < 0.5 ? i0 : i1] };
  };
  const toU = (s: number) => {
    const u = s + s0;
    return closed ? ((u % L) + L) % L : Math.min(total, Math.max(0, u));
  };
  const roadAt = (u: number) => {
    const rs = roadOf[wrap(Math.round(u / du))];
    return rs < 0 ? L : rs;
  };

  // 区間の番号: 周回は一周を checkpoints 個に、往復は U ターンの輪を長さ 0 に縮めて、ゴールがちょうど区切りに来るよう並べる
  const compress = (u: number) => (!turn || u <= L ? u : u <= L + loopLength ? L : u - loopLength);
  const uncompress = (c: number) => (!turn || c <= L ? c : c + loopLength);
  /** 縮めた距離でのスタートラインからゴールまで */
  const finishC = compress(finishU) - s0;
  const checkpoints = closed ? Math.max(4, Math.round(L / CHECKPOINT)) : Math.ceil(finishC / CHECKPOINT) + 1;
  const finishIndex = closed ? 0 : Math.ceil(finishC / CHECKPOINT);
  const indexOfU = (u: number) => {
    if (closed) return Math.min(checkpoints - 1, Math.floor(((((u - s0) % L) + L) % L / L) * checkpoints));
    const c = compress(u) - s0;
    return Math.floor((c - finishC) / CHECKPOINT) + finishIndex;
  };

  const project = (x: number, z: number, hint?: ProjectHint): CourseProjection => {
    const candidates: number[] = [];
    if (hint?.s !== undefined && hint.s !== null) {
      const u0 = toU(hint.s);
      const k = Math.round(SEARCH / du);
      const c = Math.round(u0 / du);
      for (let i = c - k; i <= c + k; i++) {
        if (closed) candidates.push(wrap(i));
        else if (i >= 0 && i < n) candidates.push(i);
      }
      if (turn && u0 > L - TURN_SEARCH && u0 < L + loopLength + TURN_SEARCH) {
        for (let i = Math.round((L - TURN_SEARCH) / du); i <= Math.round((L + loopLength + TURN_SEARCH) / du); i++) candidates.push(i);
      }
    } else {
      for (let r = 24; candidates.length === 0 && r < 400; r *= 2) grid.near(x, z, r, candidates);
      if (candidates.length === 0) for (let i = 0; i < n; i++) candidates.push(i);
    }
    const dir = hint?.dir;
    let best = candidates[0];
    let bestCost = Infinity;
    for (const i of candidates) {
      let cost = (x - xs[i]) ** 2 + (z - zs[i]) ** 2;
      if (dir && Math.sin(yaws[i]) * dir.x + Math.cos(yaws[i]) * dir.z < -0.2) cost += WRONG_WAY_PENALTY;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    // となりの点との間の線分に投影して、なめらかな距離にする
    let u = best * du;
    let bestD = Infinity;
    let offset = 0;
    for (const [a, b] of [
      [best - 1, best],
      [best, best + 1],
    ]) {
      if (!closed && (a < 0 || b >= n)) continue;
      const ia = wrap(a);
      const ib = wrap(b);
      const sx = xs[ib] - xs[ia];
      const sz = zs[ib] - zs[ia];
      const len2 = sx * sx + sz * sz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - xs[ia]) * sx + (z - zs[ia]) * sz) / len2)) : 0;
      const px = xs[ia] + sx * t;
      const pz = zs[ia] + sz * t;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < bestD) {
        bestD = d;
        u = (a + t) * du;
        // 左 = (cos yaw, -sin yaw)。線分の向きから求める
        const len = Math.sqrt(len2) || 1;
        offset = ((x - px) * (sz / len) - (z - pz) * (sx / len));
      }
    }
    if (closed) u = ((u % L) + L) % L;
    const s = closed ? (((u - s0) % L) + L) % L : u - s0;
    const onCourse = Math.abs(offset) <= widthAt(s) / 2 + ON_COURSE_MARGIN || inPlaza(x, z);
    return { s, offset, index: indexOfU(u), onCourse };
  };

  const widthAt = (s: number) => {
    const u = toU(s);
    const i = wrap(Math.round(u / du));
    return roadOf[i] < 0 ? road.widthAt(L) + 4 : road.widthAt(roadOf[i]);
  };
  const inPlaza = (x: number, z: number) => turn !== null && Math.hypot(x - turn.cx, z - turn.cz) < turn.plaza;

  const line = sample(s0);
  const fin = sample(toU(length));
  return {
    map,
    tiles: [],
    checkpoints,
    closed,
    finishIndex,
    line: { x: line.x, z: line.z, yaw: line.yaw },
    finishLine: { x: fin.x, z: fin.z, yaw: fin.yaw },
    length,
    end,
    indexAt(x, z) {
      const p = project(x, z);
      return p.onCourse ? p.index : -1;
    },
    directionAt(index) {
      if (closed) {
        const p = sample(toU(((index + 0.5) / checkpoints) * L));
        return { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
      }
      // 区間の中ほどの、縮めた距離
      const c = s0 + finishC + (index - finishIndex + 0.5) * CHECKPOINT;
      if (turn && Math.abs(c - L) < CHECKPOINT * 1.5) return { x: 0, z: 0 };
      const p = sample(uncompress(c));
      return { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    },
    pointAt: (s) => sample(toU(s)),
    project,
    widthAt,
    gridSpot(back, side = 0) {
      const p = sample(toU(-back));
      return { x: p.x + Math.cos(p.yaw) * side, z: p.z - Math.sin(p.yaw) * side, yaw: p.yaw, s: -back };
    },
    road,
    heightAt: (s) => road.heightAt(roadAt(toU(s))),
    gradeAt: (s) => {
      const u = toU(s);
      const i = wrap(Math.round(u / du));
      return dirOf[i] === 0 ? 0 : dirOf[i] * road.gradeAt(roadOf[i]);
    },
    roadS: (s) => roadAt(toU(s)),
    inPlaza,
  };
}
