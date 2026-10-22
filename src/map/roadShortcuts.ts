import type { RoadModel } from './road';
import { type Shortcut, insideShortcut, shortcutHeight, shortcutLocal } from './shortcuts';

/**
 * 中心線で描く道路のヘアピンの内側の近道（src/map/shortcuts.ts のタイルのマップと同じ考え方）。
 * 180° 回る円弧の前後が直線のヘアピンで、行きと帰りの直線にはさまれた所を走れる面にする。
 * 帯の座標は円弧の頂点が原点で、u = 頂点で進む向き、w = 円弧の中心へ向かう向き
 */
export interface RoadShortcut extends Shortcut {
  /** 円弧の半径 [m] */
  radius: number;
  /** 円弧の始まりと終わりの、道路の始まりからの距離 [m] */
  sIn: number;
  sOut: number;
}

/** 帯の奥行きの上限（円弧の中心から、直線に沿って内側へ） [m] */
const DEPTH = 18;
/** ヘアピンとみなす円弧の回る角度 [度] */
const MIN_TURN = 170;
const MAX_TURN = 190;

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** 道路のヘアピン（180° の円弧の前後が直線）を探して、内側の近道の帯を作る */
export function findRoadShortcuts(road: RoadModel): RoadShortcut[] {
  const { pieces } = road.spec;
  const result: RoadShortcut[] = [];
  pieces.forEach((p, i) => {
    if (!p.arc || Math.abs(p.arc.turn) < MIN_TURN || Math.abs(p.arc.turn) > MAX_TURN) return;
    const before = pieces[i - 1]?.straight ?? 0;
    const after = pieces[i + 1]?.straight ?? 0;
    const depth = Math.min(DEPTH, before - 2, after - 2);
    if (depth < 8) return;
    const r = p.arc.radius;
    const sIn = road.pieceStart[i];
    const sOut = road.pieceStart[i + 1];
    const apex = road.indexAt((sIn + sOut) / 2);
    const yaw = road.yaw[apex];
    // 左 = (cos yaw, -sin yaw)。曲率が正（左カーブ）なら中心は左
    const side = Math.sign(p.arc.turn);
    const rw = road.width[apex] / 2;
    result.push({
      x: road.x[apex],
      z: road.z[apex],
      ax: Math.sin(yaw),
      az: Math.cos(yaw),
      nx: side * Math.cos(yaw),
      nz: -side * Math.sin(yaw),
      uMax: r - rw + 2,
      uEdge: r - rw,
      wMin: rw - 1,
      wMax: r + depth,
      radius: r,
      sIn,
      sOut,
    });
  });
  return result;
}

/** 帯の奥行き w での、行き（side = -1）と帰り（side = 1）の道路の距離 */
function legS(sc: RoadShortcut, side: -1 | 1, w: number): number {
  const r = sc.radius;
  const along = w >= r ? w - r : -r * Math.asin(Math.min(1, (r - w) / r));
  return side < 0 ? sc.sIn - along : sc.sOut + along;
}

/**
 * 近道の帯の上の高さ（帯の外なら null、道路の上も null）。上の道路からはなめらかにつなぎ、下の道路との境目は
 * 段差にする。lowRamp は下の道路との境目を、道路の端からこの距離だけ帯の側へずらす（地形の格子用）
 */
export function roadShortcutHeight(road: RoadModel, shortcuts: readonly RoadShortcut[], x: number, z: number, lowRamp = 0): number | null {
  const sc = shortcuts.find((c) => insideShortcut(c, x, z));
  if (!sc) return null;
  // 帯の近くの道路で、いちばん近い点
  const i0 = road.indexAt(legS(sc, -1, sc.wMax + 4));
  const i1 = road.indexAt(legS(sc, 1, sc.wMax + 4));
  let k = i0;
  let best = Infinity;
  for (let i = i0; i <= i1; i++) {
    const d2 = (x - road.x[i]) ** 2 + (z - road.z[i]) ** 2;
    if (d2 < best) {
      best = d2;
      k = i;
    }
  }
  const d = Math.sqrt(best);
  const rw = road.width[k] / 2;
  if (d <= rw) return null;
  // 中心線に沿って点と点の間も補間した、いちばん近い所の路面の高さ
  const along = (x - road.x[k]) * Math.sin(road.yaw[k]) + (z - road.z[k]) * Math.cos(road.yaw[k]);
  const roadH = road.heightAt(k * road.step + along);
  const { u, w } = shortcutLocal(sc, x, z);
  const start = road.heightAt(legS(sc, -1, w));
  const end = road.heightAt(legS(sc, 1, w));
  // 行きから帰りへ（u の正の向きへ）進むと下るなら dir = 1
  const dir = start >= end ? 1 : -1;
  const cut = shortcutHeight((u * dir + sc.uEdge) / (2 * sc.uEdge), Math.max(start, end), Math.min(start, end));
  // いちばん近い道路が下の道路の側で、帯より低ければ段差
  const lowSide = shortcutLocal(sc, road.x[k], road.z[k]).u * dir > 0 && roadH < cut;
  if (lowSide) return d > rw + lowRamp ? cut : null;
  return roadH + (cut - roadH) * smoothstep((d - rw) / 3);
}
