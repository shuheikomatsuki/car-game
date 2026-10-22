import type { CarSnapshot } from '../sim/car';
import { type DriverInput, NEUTRAL_INPUT, type VehicleParams, steerLimitAt } from '../sim/vehicle';
import { type RacingLine, buildSpeedProfile } from './racingLine';

/** NPC の強さ */
export interface NpcLevel {
  id: string;
  label: string;
  /** 横方向のグリップを使う割合（大きいほどカーブを速く曲がる） */
  grip: number;
  /** ブレーキを使う割合（大きいほど奥まで突っ込んで強く止まる） */
  brake: number;
  /** レーシングラインをどれだけなぞるか（0 = 道路の中央、1 = 理想のライン） */
  line: number;
  /** 最高速度の割合 */
  topSpeed: number;
}

export const NPC_LEVELS: readonly NpcLevel[] = [
  { id: 'easy', label: '初級', grip: 0.62, brake: 0.55, line: 0.3, topSpeed: 0.8 },
  { id: 'normal', label: '中級', grip: 0.76, brake: 0.7, line: 0.7, topSpeed: 0.9 },
  { id: 'hard', label: '上級', grip: 0.88, brake: 0.82, line: 1, topSpeed: 0.97 },
  { id: 'pro', label: '達人', grip: 0.96, brake: 0.92, line: 1, topSpeed: 1 },
  { id: 'legend', label: '伝説', grip: 1, brake: 1, line: 1, topSpeed: 1 },
];

/** 他の車の位置と速度（よけるため） */
export interface Opponent {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** 止まって動けなくなったとみなす時間 [s] */
const STUCK_SECONDS = 1.5;
/** 下がって抜け出す時間 [s] */
const REVERSE_SECONDS = 1.2;

/**
 * レース用の NPC の運転。レーシングラインを先読みしてハンドルを切り（pure pursuit）、
 * 速度の計画に合わせてアクセルとブレーキを踏む。前の車に追いついたら横に出て抜き、抜けなければ速度を合わせる。
 */
export class NpcDriver {
  private readonly speed: Float64Array;
  private readonly lineX: Float64Array;
  private readonly lineZ: Float64Array;
  private stuckTime = 0;
  private reverseTime = 0;
  /** 追い越しのために足している、ラインからの横のずれ [m]（なめらかに変える） */
  private sideShift = 0;
  private lastSteer = 0;
  /** 1 より小さくすると全体にゆっくり走る（ゴール後のクールダウン） */
  pace = 1;

  constructor(
    private readonly line: RacingLine,
    private readonly params: VehicleParams,
    readonly level: NpcLevel,
    /** 同じ強さの NPC どうしでも少し差がつくよう、速度にかける係数 */
    variation = 1,
    gradient?: (x: number, z: number) => { x: number; z: number },
  ) {
    const p = { ...params, maxForwardSpeed: params.maxForwardSpeed * level.topSpeed };
    this.speed = buildSpeedProfile(line, p, { grip: level.grip * variation, brake: level.brake, gradient });
    // 弱い NPC は、理想のラインより道路の中央寄りを走る
    const course = line.course;
    this.lineX = new Float64Array(line.count);
    this.lineZ = new Float64Array(line.count);
    for (let i = 0; i < line.count; i++) {
      const c = course.pointAt(i * line.step);
      const off = line.offset[i] * level.line;
      this.lineX[i] = c.x + Math.cos(c.yaw) * off;
      this.lineZ[i] = c.z - Math.sin(c.yaw) * off;
    }
  }

  /** ライン上の距離 s [m] の点の番号 */
  private indexAt(s: number): number {
    const n = this.line.count;
    const i = Math.round(s / this.line.step);
    return this.line.course.closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
  }

  /** s での目標速度（その先の少しの区間の最小値。反応の遅れを見込む） */
  targetSpeed(s: number, ahead: number): number {
    let v = Infinity;
    for (let d = 0; d <= ahead; d += this.line.step) v = Math.min(v, this.speed[this.indexAt(s + d)]);
    return v;
  }

  update(dt: number, car: CarSnapshot, opponents: readonly Opponent[]): DriverInput {
    const course = this.line.course;
    const p = this.params;
    const v = car.forwardSpeed;

    // 壁などに引っかかって止まったら、少し下がってやり直す
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      // 下がりながら、行きたい向きと逆にハンドルを切って向きを直す
      return { throttle: 0, brake: 1, steer: -this.lastSteer };
    }
    this.stuckTime = Math.abs(v) < 1 ? this.stuckTime + dt : 0;
    if (this.stuckTime > STUCK_SECONDS) {
      this.stuckTime = 0;
      this.reverseTime = REVERSE_SECONDS;
      return NEUTRAL_INPUT;
    }

    const here = course.project(car.x, car.z);
    const sin = Math.sin(car.yaw);
    const cos = Math.cos(car.yaw);

    // --- 前の車 ---
    let follow = Infinity;
    let wantShift = 0;
    const limit = course.map.def.roadWidth / 2 - 1.4;
    for (const o of opponents) {
      const op = course.project(o.x, o.z);
      let gap = op.s - here.s;
      if (course.closed) gap = ((gap % course.length) + course.length * 1.5) % course.length - course.length / 2;
      if (gap <= 0 || gap > 30) continue;
      const lateral = op.offset - here.offset;
      if (Math.abs(lateral) > 3) continue;
      const ov = o.vx * sin + o.vz * cos;
      const closing = v - ov;
      if (closing <= 0.5 && gap > 8) continue;
      // 空いている側へ出る（道幅に余裕があるほう）
      const roomLeft = limit - op.offset;
      const roomRight = op.offset + limit;
      const side = roomLeft > roomRight ? 1 : -1;
      const target = op.offset + side * 3.2 - this.line.offset[this.indexAt(here.s)] * this.level.line;
      wantShift = Math.abs(target) > Math.abs(wantShift) ? target : wantShift;
      // 横に並ぶ余裕がなければ、ぶつからないよう速度を合わせる
      const room = side > 0 ? roomLeft : roomRight;
      if (room < 3 || gap < 6) follow = Math.min(follow, ov + Math.max(0, gap - 5) * 0.6);
    }
    this.sideShift += (wantShift - this.sideShift) * Math.min(1, dt * 1.5);

    // --- ハンドル（先読みした点へ向かう） ---
    const lookahead = Math.max(6, Math.abs(v) * 0.5 + 4);
    const ti = this.indexAt(here.s + lookahead);
    const tyaw = course.pointAt(ti * this.line.step).yaw;
    let tx = this.lineX[ti] + Math.cos(tyaw) * this.sideShift;
    let tz = this.lineZ[ti] - Math.sin(tyaw) * this.sideShift;
    // 道路の外へは出ない
    const tp = course.project(tx, tz);
    if (Math.abs(tp.offset) > limit) {
      const fix = tp.offset - Math.sign(tp.offset) * limit;
      tx -= Math.cos(tyaw) * fix;
      tz += Math.sin(tyaw) * fix;
    }
    const dx = tx - car.x;
    const dz = tz - car.z;
    const forward = dx * sin + dz * cos;
    const left = dx * cos - dz * sin;
    const dist = Math.hypot(dx, dz);
    const alpha = Math.atan2(left, forward);
    const steerAngle = Math.atan((2 * p.wheelBase * Math.sin(alpha)) / Math.max(1, dist));
    const steer = Math.max(-1, Math.min(1, steerAngle / steerLimitAt(Math.max(1, v), p)));

    // --- アクセル・ブレーキ ---
    let target = this.targetSpeed(here.s, Math.max(4, v * 0.25)) * this.pace;
    target = Math.min(target, follow);
    // 大きく向きがずれているとき（スピン後など）はゆっくり戻る
    if (Math.abs(alpha) > 1.2) target = Math.min(target, 8);
    const err = target - v;
    let throttle = 0;
    let brake = 0;
    if (err > 0) {
      // 速度を保つのに必要な分（空気抵抗に見合うアクセル）に、足りない分を上乗せする
      const hold = (p.dragCoef * v * v) / Math.max(0.5, p.engineAccel * Math.max(0.05, 1 - v / p.maxForwardSpeed));
      throttle = Math.min(1, hold + err * 0.6);
    } else if (err < -0.4) {
      brake = Math.min(1, -err * 0.35);
    }
    this.lastSteer = steer;
    return { throttle, brake, steer };
  }
}
