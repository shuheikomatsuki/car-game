import type { CarState } from './protocol';

/** 他のプレイヤーの車を、受信した時刻よりこれだけ過去の位置で表示する [ms]（間を補間するため） */
export const INTERPOLATION_DELAY_MS = 100;
/** 受信が途切れたとき、速度から先を予測して動かし続ける上限 [ms] */
export const MAX_EXTRAPOLATION_MS = 300;
const BUFFER_MS = 1000;

interface Sample {
  time: number;
  s: CarState;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/**
 * 1人分の受信した車の状態を貯めて、表示する時刻の状態を求める。
 * - 送信側の時計と自分の時計のずれ（offset）を、届くのが一番早かったパケットから推定する
 * - 表示時刻 = いま - ずれ - INTERPOLATION_DELAY_MS。前後の受信値を線形補間する
 * - 途切れたら、最後の速度と向きで MAX_EXTRAPOLATION_MS まで先を予測する
 */
export class RemoteTrack {
  private samples: Sample[] = [];
  private offset: number | null = null;
  private lastReceivedAt = -Infinity;

  constructor(
    private readonly delayMs = INTERPOLATION_DELAY_MS,
    private readonly maxExtrapolationMs = MAX_EXTRAPOLATION_MS,
  ) {}

  push(remoteTime: number, s: CarState, localNow: number): void {
    const last = this.samples.at(-1);
    // 順番が入れ替わって届いた古い値は捨てる
    if (last && remoteTime <= last.time) return;
    const observed = localNow - remoteTime;
    // 早く届いたものほど実際のずれに近い。遅れて届いたものにはゆっくりしか追従しない
    if (this.offset === null || observed < this.offset) this.offset = observed;
    else this.offset += (observed - this.offset) * 0.01;
    this.samples.push({ time: remoteTime, s });
    this.lastReceivedAt = localNow;
    const oldest = remoteTime - BUFFER_MS;
    while (this.samples.length > 2 && this.samples[0].time < oldest) this.samples.shift();
  }

  /** 最後に受信してからの時間 [ms] */
  silenceMs(localNow: number): number {
    return localNow - this.lastReceivedAt;
  }

  sample(localNow: number): CarState | null {
    if (this.samples.length === 0 || this.offset === null) return null;
    const t = localNow - this.offset - this.delayMs;
    const first = this.samples[0];
    if (t <= first.time) return first.s;
    for (let i = this.samples.length - 1; i > 0; i--) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      if (t >= a.time && t <= b.time) {
        const k = (t - a.time) / (b.time - a.time);
        return interpolate(a.s, b.s, k);
      }
    }
    // 最新の値より先: 速度と向きで予測する
    const last = this.samples[this.samples.length - 1];
    const dt = Math.min(t - last.time, this.maxExtrapolationMs) / 1000;
    const [x, z, yaw, speed, steer, spin] = last.s;
    return [x + Math.sin(yaw) * speed * dt, z + Math.cos(yaw) * speed * dt, yaw, speed, steer, spin];
  }
}

function interpolate(a: CarState, b: CarState, k: number): CarState {
  const lerp = (i: number) => a[i] + (b[i] - a[i]) * k;
  return [lerp(0), lerp(1), lerpAngle(a[2], b[2], k), lerp(3), lerp(4), lerp(5)];
}
