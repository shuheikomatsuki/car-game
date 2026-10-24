/** 他の人の車のうち、前を照らすライトを付ける台数（ライトが増えるほど描画が重くなるので、近い車だけ） */
export const REMOTE_HEADLIGHTS = 2;
/** これより遠い車のライトは照らさない [m]（車のライト自体は光って見える） */
export const REMOTE_HEADLIGHT_RANGE = 150;

/**
 * 前を照らすライトを付ける車を選ぶ: ライトをつけて見えている車のうち、(x, z) に近い順に max 台
 */
export function nearestLit<T extends { x: number; z: number; lit: boolean }>(
  cars: readonly T[],
  x: number,
  z: number,
  max = REMOTE_HEADLIGHTS,
  range = REMOTE_HEADLIGHT_RANGE,
): T[] {
  return cars
    .filter((c) => c.lit)
    .map((c) => ({ c, d: Math.hypot(c.x - x, c.z - z) }))
    .filter((e) => e.d <= range)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.c);
}
