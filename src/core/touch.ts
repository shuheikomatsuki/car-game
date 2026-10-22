/** 指をこの距離 [px] 横に動かすとハンドルを切りきる */
export const STEER_RADIUS_PX = 64;
/** ハンドルとして無視する小さな指のずれ（STEER_RADIUS_PX に対する割合） */
const STEER_DEADZONE = 0.08;

/**
 * 指を置いた位置からの横のずれ [px] をハンドル入力（左が正、-1〜1）に変える。
 * 右になぞると右に曲がる。
 */
export function steerFromDrag(dx: number, radius = STEER_RADIUS_PX): number {
  const v = Math.max(-1, Math.min(1, dx / radius));
  if (Math.abs(v) < STEER_DEADZONE) return 0; // -0 も 0 にそろえる
  return (-Math.sign(v) * (Math.abs(v) - STEER_DEADZONE)) / (1 - STEER_DEADZONE);
}

/** ハンドルのつまみを描く位置 [px]（指を置いた位置からのずれを、切りきる位置で止める） */
export function knobOffset(dx: number, radius = STEER_RADIUS_PX): number {
  return Math.max(-radius, Math.min(radius, dx));
}
