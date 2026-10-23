import type { Standing } from '../game/npcRace';

/** オンライン対戦の1人分（自分は自分の計測、他の人は受け取った距離とゴールの知らせから） */
export interface OnlineEntrant {
  name: string;
  color: number;
  isPlayer: boolean;
  /** コースを進んだ距離 [m]（周回は積み上げ） */
  distance: number;
  /** ゴールしたタイム [s]（まだなら null） */
  total: number | null;
  /** 走り終えた周の数 */
  laps: number;
}

/** 順位を決める。ゴールした人はタイム順、まだ走っている人は進んだ距離の順 */
export function rankOnline(entrants: readonly OnlineEntrant[]): Standing[] {
  return [...entrants]
    .sort((a, b) => {
      if (a.total !== null && b.total !== null) return a.total - b.total;
      if (a.total !== null) return -1;
      if (b.total !== null) return 1;
      return b.distance - a.distance;
    })
    .map(({ name, color, isPlayer, total, laps }) => ({ name, color, isPlayer, total, laps }));
}

/**
 * 走行中に出す順位の並び（スマホでも画面を埋めないよう、上位 top 人と、その外にいれば自分だけ）。
 * 各行に本当の順位を付けて返す
 */
export function standingsWindow<T extends { isPlayer: boolean }>(list: readonly T[], top = 3): { rank: number; entry: T }[] {
  const rows = list.slice(0, top).map((entry, i) => ({ rank: i + 1, entry }));
  const me = list.findIndex((e) => e.isPlayer);
  if (me >= top) rows.push({ rank: me + 1, entry: list[me] });
  return rows;
}

/** 周回のコースで、進んだ距離から走り終えた周の数を出す */
export function lapsDone(distance: number, courseLength: number, closed: boolean, totalLaps: number): number {
  if (!closed || courseLength <= 0) return 0;
  return Math.max(0, Math.min(totalLaps, Math.floor(distance / courseLength)));
}
