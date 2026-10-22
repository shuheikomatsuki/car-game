/** この角度 [rad] 傾けるとハンドルを切りきる */
export const TILT_FULL_LOCK = (35 * Math.PI) / 180;
/** ハンドルとして無視する小さな傾き [rad] */
const TILT_DEADZONE = (3 * Math.PI) / 180;
/** 重力が画面の面にこれ [m/s²] 未満しかかからない（ほぼ平らに置いた）ときは傾きを測らない */
const MIN_GRAVITY_IN_PLANE = 3;

/**
 * 加速度センサー（重力込み）の x, y から、端末を画面に向かって時計回りに回した角度 [rad] を求める。
 * 平らに近くて測れないときは null。
 * 端末によって軸の向きが全部逆のことがあるが、その場合も角度が 180° ずれるだけで
 * 回した向きは変わらないので、基準からの差（tiltSteer）で使えば問題ない。
 */
export function rollAngle(ax: number, ay: number): number | null {
  if (Math.hypot(ax, ay) < MIN_GRAVITY_IN_PLANE) return null;
  return Math.atan2(-ax, ay);
}

/**
 * 基準の角度（まっすぐ走るときの持ち方）からの傾きをハンドル入力（左が正、-1〜1）に変える。
 * 時計回り（右を下げる）に傾けると右に曲がる。
 */
export function tiltSteer(angle: number, neutral: number): number {
  const diff = Math.atan2(Math.sin(angle - neutral), Math.cos(angle - neutral));
  const mag = Math.abs(diff);
  if (mag < TILT_DEADZONE) return 0;
  const v = Math.min(1, (mag - TILT_DEADZONE) / (TILT_FULL_LOCK - TILT_DEADZONE));
  return -Math.sign(diff) * v;
}
