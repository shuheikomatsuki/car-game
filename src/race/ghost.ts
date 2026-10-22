/**
 * ゴースト（過去の走りの再生）。一定間隔で車の位置と向きを記録し、時刻を指定して取り出す。
 */

/** 記録する間隔 [s] */
export const GHOST_INTERVAL = 0.1;

export interface GhostPose {
  x: number;
  z: number;
  yaw: number;
}

/** [x, z, yaw] を並べたもの（保存しやすいよう平らな配列） */
export type GhostData = number[];

export class GhostRecorder {
  private readonly data: GhostData = [];
  private nextTime = 0;

  /** time はスタートからの時間 [s]。記録する時刻になっていれば記録する */
  sample(time: number, pose: GhostPose): void {
    if (time < this.nextTime) return;
    const r = (v: number, k: number) => Math.round(v * k) / k;
    this.data.push(r(pose.x, 100), r(pose.z, 100), r(pose.yaw, 1000));
    this.nextTime += GHOST_INTERVAL;
  }

  get frames(): GhostData {
    return this.data;
  }
}

/** 記録した走りの、スタートから time 秒の位置（記録の範囲外なら null） */
export function ghostPoseAt(data: GhostData, time: number): GhostPose | null {
  const count = data.length / 3;
  if (count === 0 || time < 0) return null;
  const f = time / GHOST_INTERVAL;
  const i = Math.floor(f);
  if (i >= count - 1) return null;
  const t = f - i;
  const a = i * 3;
  const b = a + 3;
  let dyaw = data[b + 2] - data[a + 2];
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return {
    x: data[a] + (data[b] - data[a]) * t,
    z: data[a + 1] + (data[b + 1] - data[a + 1]) * t,
    yaw: data[a + 2] + dyaw * t,
  };
}
