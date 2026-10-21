import type { ParsedMap } from '../map/tilemap';
import type { CarSnapshot } from '../sim/car';
import {
  type DriverInput,
  type VehicleParams,
  DEFAULT_VEHICLE_PARAMS,
  NEUTRAL_INPUT,
  steerLimitAt,
} from '../sim/vehicle';
import type { ObstacleSensor } from '../sim/sensors';
import { type Command, isEmergency } from './commands';
import { RoutePlanner, type Turn } from './navigation';
import { type Personality, randomBetween } from './personality';

/** 選べる巡航速度 [km/h] */
export const SPEED_LEVELS_KMH = [12, 20, 30, 40];
const DEFAULT_SPEED_LEVEL = 1;
/** 計画上の減速度 [m/s^2]（実際のブレーキ性能より十分小さくして余裕を持たせる） */
const PLAN_DECEL = 2.5;

export type DriverState = 'parked' | 'driving' | 'stopping' | 'panic';

export type DriverEvent =
  | { type: 'ack'; command: Command; misheard?: boolean; speedKmh?: number }
  | { type: 'askDirection' }
  | { type: 'turning'; turn: Turn }
  | { type: 'wrongTurn' }
  | { type: 'tooLate' }
  | { type: 'obstacle' }
  | { type: 'suddenBrake' }
  | { type: 'stopped' }
  | { type: 'collision' }
  | { type: 'lost' };

interface QueuedCommand {
  at: number;
  command: Command;
}

const TURN_OF: Partial<Record<Command, Turn>> = {
  turnLeft: 'left',
  turnRight: 'right',
  straight: 'straight',
  correctLeft: 'left',
  correctRight: 'right',
};

const MIRROR: Partial<Record<Command, Command>> = {
  turnLeft: 'turnRight',
  turnRight: 'turnLeft',
};

/**
 * 運転が苦手なキャラクター。指示と道路状況から、手動運転と同じ DriverInput を作る。
 * - 経路は RoutePlanner が左車線に沿って作る。交差点の方向は指示で決まる。
 * - ハンドルは Pure Pursuit（少し先の経路上の点に向けて舵を切る）、速度は目標速度への比例制御。
 * - 性格（Personality）に応じて、反応の遅れ・聞き間違い・曲がり間違い・急ブレーキ・ふらつきが入る。
 */
export class CharacterDriver {
  private readonly planner: RoutePlanner;
  private stateValue: DriverState = 'parked';
  private speedLevel = DEFAULT_SPEED_LEVEL;
  private time = 0;
  private queue: QueuedCommand[] = [];
  private localized = false;
  private events: DriverEvent[] = [];
  private obstacleAhead = false;
  /** 「発進」で障害物を押してでも進む（コーン等）期限 */
  private pushThroughUntil = 0;
  private suddenBrakeUntil = 0;
  private lostReported = false;
  private readonly wobblePhase: number;

  constructor(
    map: ParsedMap,
    readonly personality: Personality,
    private readonly rng: () => number,
    private readonly params: VehicleParams = DEFAULT_VEHICLE_PARAMS,
  ) {
    this.planner = new RoutePlanner(map, {
      chooseExit: (intended, options) => {
        const others = options.filter((d) => d !== intended);
        if (others.length > 0 && this.rng() < this.personality.wrongTurnChance) {
          return others[Math.floor(this.rng() * others.length)];
        }
        return intended;
      },
    });
    this.wobblePhase = rng() * Math.PI * 2;
  }

  get state(): DriverState {
    return this.stateValue;
  }

  get speedKmh(): number {
    return SPEED_LEVELS_KMH[this.speedLevel];
  }

  get pendingTurn(): Turn | null {
    return this.planner.pendingTurn;
  }

  get route(): RoutePlanner {
    return this.planner;
  }

  /** 車がリセット・テレポートしたとき */
  reset(): void {
    this.stateValue = 'parked';
    this.queue = [];
    this.localized = false;
    this.obstacleAhead = false;
    this.speedLevel = DEFAULT_SPEED_LEVEL;
  }

  /** 指示を受け取る。反応の遅れの後で実行される */
  command(command: Command): void {
    const delay = randomBetween(
      this.rng,
      isEmergency(command) ? this.personality.emergencyDelay : this.personality.reactionDelay,
    );
    this.queue.push({ at: this.time + delay, command });
    this.queue.sort((a, b) => a.at - b.at);
  }

  /** 衝突したとき（main から強さが閾値を超えたら呼ぶ） */
  notifyCollision(): void {
    this.events.push({ type: 'collision' });
    if (this.stateValue === 'driving') this.stateValue = 'stopping';
  }

  drainEvents(): DriverEvent[] {
    return this.events.splice(0);
  }

  /**
   * 毎ステップ呼ぶ。
   * sense: 指定した向き・距離に障害物があるか調べる関数（経路の先に向けて使う）
   */
  update(dt: number, car: CarSnapshot, sense: ObstacleSensor): DriverInput {
    this.time += dt;
    while (this.queue.length && this.queue[0].at <= this.time) {
      this.execute(this.queue.shift()!.command);
    }

    const v = car.forwardSpeed;
    if (!this.localized) {
      this.localized = this.planner.localize(car.x, car.z, car.yaw);
      if (!this.localized) return this.lost(v);
    }
    const commit = Math.max(25, v * 3 + 15);
    if (!this.planner.update(car.x, car.z, commit)) {
      this.localized = this.planner.localize(car.x, car.z, car.yaw);
      if (!this.localized || !this.planner.update(car.x, car.z, commit)) return this.lost(v);
    }
    this.lostReported = false;
    this.handlePlannerEvents();

    // --- 目標速度 ---
    let target = 0;
    if (this.stateValue === 'driving') {
      const horizon = Math.max(30, (v * v) / (2 * PLAN_DECEL) + 10);
      target = Math.min(this.speedKmh / 3.6, this.planner.safeSpeed(horizon, PLAN_DECEL));

      // 止まりきれる距離の少し先まで、経路上の点に向けて障害物を探す。
      // 一度止まったら少し余裕を持たせて、近づく→止まる→動くを繰り返さないようにする
      const stopDistance = (v * v) / (2 * 4) + 4 + (this.obstacleAhead ? 1.5 : 0);
      const blocked = this.time > this.pushThroughUntil && this.senseAlongRoute(car, sense, stopDistance);
      if (blocked && !this.obstacleAhead) this.events.push({ type: 'obstacle' });
      this.obstacleAhead = blocked;
      if (blocked) target = 0;
      if (this.time < this.pushThroughUntil) target = Math.min(target, 2);

      this.maybeSuddenBrake(dt, v);
      if (this.time < this.suddenBrakeUntil) target = 0;
    }

    const input = this.speedControl(target, v);
    input.steer = this.stateValue === 'parked' && Math.abs(v) < 0.3 ? 0 : this.steering(car);

    if ((this.stateValue === 'stopping' || this.stateValue === 'panic') && Math.abs(v) < 0.3) {
      this.stateValue = 'parked';
      this.events.push({ type: 'stopped' });
    }
    return input;
  }

  private execute(command: Command): void {
    const ack = (extra: Partial<Extract<DriverEvent, { type: 'ack' }>> = {}) =>
      this.events.push({ type: 'ack', command, ...extra });

    switch (command) {
      case 'start':
        if (this.obstacleAhead) this.pushThroughUntil = this.time + 3;
        this.stateValue = 'driving';
        ack();
        if (this.planner.isWaitingForDirection) this.events.push({ type: 'askDirection' });
        break;
      case 'faster':
        this.speedLevel = Math.min(SPEED_LEVELS_KMH.length - 1, this.speedLevel + 1);
        if (this.stateValue !== 'driving') this.stateValue = 'driving';
        ack({ speedKmh: this.speedKmh });
        break;
      case 'slower':
        this.speedLevel = Math.max(0, this.speedLevel - 1);
        ack({ speedKmh: this.speedKmh });
        break;
      case 'stop':
        if (this.stateValue !== 'parked') this.stateValue = 'stopping';
        ack();
        break;
      case 'danger':
        this.stateValue = 'panic';
        ack();
        break;
      case 'turnLeft':
      case 'turnRight': {
        // 聞き間違えると逆の方向だと思い込む（返事で気づけるように、言い間違えたまま返事する）
        const misheard = this.rng() < this.personality.mishearChance;
        const heard = misheard ? MIRROR[command]! : command;
        this.planner.setTurn(TURN_OF[heard]!);
        this.events.push({ type: 'ack', command: heard, misheard });
        break;
      }
      case 'straight':
        this.planner.setTurn('straight');
        ack();
        break;
      case 'correctLeft':
      case 'correctRight': {
        const result = this.planner.correct(TURN_OF[command]!);
        if (result === 'tooLate') this.events.push({ type: 'tooLate' });
        else ack();
        break;
      }
    }
  }

  private handlePlannerEvents(): void {
    for (const e of this.planner.drainEvents()) {
      if (e.type === 'askDirection') {
        if (this.stateValue === 'driving') this.events.push({ type: 'askDirection' });
      } else if (e.type === 'enterJunction') {
        if (e.mistaken) this.events.push({ type: 'wrongTurn' });
        else if (e.turn !== 'straight') this.events.push({ type: 'turning', turn: e.turn });
      }
    }
  }

  private maybeSuddenBrake(dt: number, v: number): void {
    if (v < 4 || this.time < this.suddenBrakeUntil + 5) return;
    const chance = (this.personality.suddenBrakePerMinute / 60) * dt;
    if (this.rng() < chance) {
      this.suddenBrakeUntil = this.time + 0.5 + this.rng() * 0.4;
      this.events.push({ type: 'suddenBrake' });
    }
  }

  /** 目標速度へ近づけるアクセル・ブレーキ操作 */
  private speedControl(target: number, v: number): DriverInput {
    const input = { ...NEUTRAL_INPUT };
    if (this.stateValue === 'panic') {
      // 慌てて思い切りブレーキ（停止寸前で離さないと後退してしまう）
      if (v > 0.6) input.brake = 1;
      return input;
    }
    const err = target - v;
    if (target > 0.3 && err > 0) {
      input.throttle = Math.min(1, 0.2 + err * 0.4);
    } else if (err < -0.4 && v > 0.6) {
      input.brake = Math.min(1, Math.max(0.15, -err * 0.35));
    }
    return input;
  }

  private senseAlongRoute(car: CarSnapshot, sense: ObstacleSensor, distance: number): boolean {
    const front = 2.25;
    const target = this.planner.pointAt(this.planner.progress + front + distance);
    const yaw = Math.atan2(target.x - car.x, target.z - car.z);
    const hit = sense(yaw, distance);
    return hit !== null && hit < distance;
  }

  /** Pure Pursuit: 少し先の経路上の点へ向かうように舵を切る */
  private steering(car: CarSnapshot): number {
    const v = Math.max(0, car.forwardSpeed);
    const lookahead = Math.min(12, Math.max(4, 3 + v * 0.6));
    const target = this.planner.pointAt(this.planner.progress + lookahead);
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const dx = target.x - car.x;
    const dz = target.z - car.z;
    const forward = dx * fx + dz * fz;
    const left = dx * fz - dz * fx;
    const alpha = Math.atan2(left, forward);
    const delta = Math.atan((2 * this.params.wheelBase * Math.sin(alpha)) / lookahead);
    const wobble =
      this.personality.steerWobble *
      (Math.sin(this.time * 1.3 + this.wobblePhase) + 0.5 * Math.sin(this.time * 3.1 + this.wobblePhase * 2));
    const steer = delta / steerLimitAt(Math.max(v, 0.1), this.params) + wobble;
    return Math.max(-1, Math.min(1, steer));
  }

  private lost(v: number): DriverInput {
    if (!this.lostReported) {
      this.events.push({ type: 'lost' });
      this.lostReported = true;
    }
    if (this.stateValue === 'driving') this.stateValue = 'stopping';
    return this.speedControl(0, v);
  }
}
