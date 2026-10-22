import type { GhostData } from './ghost';

/**
 * タイムアタックの自己ベスト。コースと車の組み合わせごとに、このブラウザの localStorage に保存する。
 */

export interface RaceRecord {
  /** 規定周回の合計タイム [s] */
  total: number;
  laps: number[];
  /** これまでの最速の1周（合計タイムが更新されなかった走りのものも含む） */
  bestLap: number;
  /** 合計タイムが最速だった走りのゴースト */
  ghost: GhostData;
}

const PREFIX = 'car-game:time-attack:v1:';

function key(course: string, car: string): string {
  return `${PREFIX}${course}:${car}`;
}

export function loadRecord(course: string, car: string): RaceRecord | null {
  try {
    const raw = localStorage.getItem(key(course, car));
    return raw ? parseRecord(raw) : null;
  } catch {
    return null;
  }
}

export function saveRecord(course: string, car: string, record: RaceRecord): boolean {
  try {
    localStorage.setItem(key(course, car), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 保存された文字列を読む（壊れていたら null） */
export function parseRecord(raw: string): RaceRecord | null {
  try {
    const o = JSON.parse(raw) as Partial<RaceRecord>;
    if (!finite(o.total) || !Array.isArray(o.laps) || !o.laps.every(finite)) return null;
    const ghost = Array.isArray(o.ghost) && o.ghost.every(finite) && o.ghost.length % 3 === 0 ? o.ghost : [];
    const bestLap = finite(o.bestLap) ? o.bestLap : Math.min(...o.laps);
    return { total: o.total, laps: o.laps, bestLap, ghost };
  } catch {
    return null;
  }
}

/**
 * 今回の走りを自己ベストに反映する。合計タイムが速ければ走り全体（ゴーストも）を、
 * そうでなくても1周の最速が出ていればそれだけを書き換える。
 */
export function mergeRecord(
  best: RaceRecord | null,
  run: { total: number; laps: number[]; ghost: GhostData },
): { record: RaceRecord; newTotal: boolean; newLap: boolean } {
  const runBestLap = Math.min(...run.laps);
  const newTotal = !best || run.total < best.total;
  const newLap = !best || runBestLap < best.bestLap;
  const bestLap = best ? Math.min(best.bestLap, runBestLap) : runBestLap;
  const record = newTotal ? { ...run, bestLap } : { ...best!, bestLap };
  return { record, newTotal, newLap };
}
