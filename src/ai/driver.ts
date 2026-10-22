import { DIR_YAW, type ParsedMap, tileCenter } from '../map/tilemap';
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
import { RoutePlanner, type Turn, wrapAngle } from './navigation';
import { type Personality, randomBetween } from './personality';

/** 選べる巡航速度 [km/h] */
export const SPEED_LEVELS_KMH = [20, 30, 40, 50, 60, 80, 100];
const DEFAULT_SPEED_LEVEL = 2;
/** 曲がり始める速さの目安 [m/s]（指示された交差点に間に合うかの判断に使う） */
const TURN_ENTRY_SPEED = 4;
/** 計画上の減速度 [m/s^2]（実際のブレーキ性能より十分小さくして余裕を持たせる） */
const PLAN_DECEL = 2.5;

/**
 * 車線からの横のずれ [m]（+ が左）。左車線の中心が 0、道の中央線が -3、反対車線の中心が -6。
 * 指示で寄せたり、障害物をよけたりするときに使う。
 */
const SHIFT_STEP = 1.5;
const SHIFT_MIN = -6;
const SHIFT_MAX = 1.5;
/** 障害物をよけるときに試す横のずれ（道の中央寄り → 反対車線 → 路肩寄りの順に近いものから） */
const AVOID_SHIFTS = [-3, -1.5, -4.5, 1.5, -6];
/** よけた障害物を通り過ぎてから元の位置へ戻るまでの距離 [m] */
const AVOID_CLEARANCE = 12;

/** 自由に走るときに曲がる角度 [度]（「右に曲がって」と「ちょっと右」） */
const FREE_TURN_DEG = 90;
const FREE_NUDGE_DEG = 20;
/** 「右」「左」だけの指示で、この距離までに曲がれる交差点があればそこで曲がる [m] */
const GO_JUNCTION_RANGE = 40;
/** そのときに想定する減速度 [m/s^2] */
const GO_DECEL = 4.5;

/**
 * 走り方。
 * - free: 指示された向きへまっすぐ走る（ふだんはこちら）。勝手に曲がったり減速したりしない。道路から外れてもよい
 * - route: 「道なりに走って」と言われたときだけ、道路に沿って走る（カーブの手前で減速し、突き当たりは自分で曲がる）
 */
export type DriveMode = 'route' | 'free';

export type DriverState = 'parked' | 'driving' | 'stopping' | 'panic';

export type DriverEvent =
  | { type: 'ack'; command: Command; misheard?: boolean; speedKmh?: number; delaySeconds?: number }
  | { type: 'autoTurn'; turn: Turn }
  | { type: 'turning'; turn: Turn }
  | { type: 'uturning' }
  | { type: 'wrongTurn' }
  | { type: 'tooLate' }
  | { type: 'obstacle' }
  | { type: 'avoid' }
  | { type: 'suddenBrake' }
  | { type: 'stopped' }
  | { type: 'collision' }
  /** 道路から外れて、自由に走り始めた */
  | { type: 'offRoad' }
  /** 「道に戻って」で道路に着いた */
  | { type: 'rejoin' };

/** 指示に付いてくる数値（「3秒後に」「50メートル先で」「30度」） */
export interface CommandOptions {
  delaySeconds?: number;
  distanceMeters?: number;
  angleDeg?: number;
}

interface QueuedCommand {
  at: number;
  command: Command;
  options: CommandOptions;
  /** 受け取ったときに返事を済ませた（時間指定の指示） */
  acked: boolean;
}

const TURN_OF: Partial<Record<Command, Turn>> = {
  turnLeft: 'left',
  turnRight: 'right',
  goLeft: 'left',
  goRight: 'right',
  steerLeft: 'left',
  steerRight: 'right',
  straight: 'straight',
  correctLeft: 'left',
  correctRight: 'right',
};

const SHIFT_OF: Partial<Record<Command, number>> = {
  shiftLeft: SHIFT_STEP,
  shiftRight: -SHIFT_STEP,
};

const MIRROR: Partial<Record<Command, Command>> = {
  turnLeft: 'turnRight',
  turnRight: 'turnLeft',
  goLeft: 'goRight',
  goRight: 'goLeft',
  steerLeft: 'steerRight',
  steerRight: 'steerLeft',
};

/**
 * 運転が苦手なキャラクター。指示と道路状況から、手動運転と同じ DriverInput を作る。
 * - ふだんは指示された向きへまっすぐ走るだけ。「右に曲がって」「30度左」「3秒後に左」などで向きを変える（コースアウトしてもよい）。
 * - 「道なりに走って」と言われたときだけ、RoutePlanner が作る左車線に沿った経路を走る。
 * - ハンドルは Pure Pursuit（少し先の経路上の点に向けて舵を切る）、速度は目標速度への比例制御。
 *   狙う点は車線から横にずらせる（指示で寄せる・障害物をよける・ゆるやかに揺らぐ）ので、線の上をなぞるだけにはならない。
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
  private modeValue: DriveMode = 'free';
  /** 次の update で、いまの車の向きを自由に走る向きにする */
  private needHeading = true;
  /** 「道なりに走って」で道路へ向かっている（着いたら道なりに走る） */
  private followAfterReturn = false;
  /** 自由に走るときに向かう向き（yaw） */
  private freeHeading = 0;
  /** 「道に戻って」で向かう道路の点 */
  private returnTarget: { x: number; z: number } | null = null;
  /** 最後に見た車の向きと位置 */
  private lastYaw = 0;
  private lastPos = { x: 0, z: 0 };
  /** 最後に見た車の速さ [m/s] */
  private lastSpeed = 0;
  private readonly wobblePhase: number;
  /** 指示で寄せた横のずれ [m] */
  private userShift = 0;
  /** 障害物をよけるための横のずれ [m]（よけていなければ null） */
  private avoidShift: number | null = null;
  /** よけ終わる走行距離 */
  private avoidUntil = 0;
  /** いまハンドルで狙っている横のずれ [m]（目標へなめらかに近づける） */
  private shift = 0;
  /** 走った距離の合計 [m] */
  private travelled = 0;

  constructor(
    private readonly map: ParsedMap,
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

  get mode(): DriveMode {
    return this.modeValue;
  }

  /** 車がリセット・テレポートしたとき */
  reset(): void {
    this.stateValue = 'parked';
    this.queue = [];
    this.localized = false;
    this.obstacleAhead = false;
    this.speedLevel = DEFAULT_SPEED_LEVEL;
    this.userShift = 0;
    this.avoidShift = null;
    this.shift = 0;
    this.modeValue = 'free';
    this.needHeading = true;
    this.returnTarget = null;
    this.followAfterReturn = false;
  }

  /** いま狙っている車線からの横のずれ [m]（+ が左） */
  get lateralShift(): number {
    return this.shift;
  }

  /**
   * 指示を受け取る。反応の遅れの後で実行される。
   * 「3秒後に」「50メートル先で」が付いていれば、その分だけ遅らせて実行する（返事はすぐにする）
   */
  command(command: Command, options: CommandOptions = {}): void {
    let delay = randomBetween(
      this.rng,
      isEmergency(command) ? this.personality.emergencyDelay : this.personality.reactionDelay,
    );
    let later = options.delaySeconds ?? 0;
    if (options.distanceMeters !== undefined) later += options.distanceMeters / Math.max(3, this.lastSpeed);
    const acked = later > 0;
    if (acked) {
      delay += later;
      this.events.push({ type: 'ack', command, delaySeconds: Math.round(later) });
    }
    this.queue.push({ at: this.time + delay, command, options, acked });
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
      const q = this.queue.shift()!;
      this.execute(q.command, q.options, q.acked);
    }

    const v = car.forwardSpeed;
    this.lastSpeed = v;
    this.lastYaw = car.yaw;
    this.lastPos = { x: car.x, z: car.z };
    this.travelled += Math.abs(v) * dt;
    if (this.needHeading) {
      this.freeHeading = car.yaw;
      this.needHeading = false;
    }
    if (this.modeValue === 'route' && !this.followRoute(car)) {
      // 道なりに走っていて道路から外れた: そのままの向きで自由に走る
      this.enterFree(car.yaw, this.stateValue === 'driving');
    }
    if (this.modeValue === 'free') this.steerFree(car);

    // --- 目標速度 ---
    let target = 0;
    if (this.stateValue === 'driving') {
      const pushing = this.time < this.pushThroughUntil;
      // 止まりきれる距離の少し先まで障害物を探す。
      // 一度止まったら少し余裕を持たせて、近づく→止まる→動くを繰り返さないようにする
      const stopDistance = (v * v) / (2 * 4) + 4 + (this.obstacleAhead ? 1.5 : 0);
      let blocked: boolean;
      if (this.modeValue === 'route') {
        const horizon = Math.max(30, (v * v) / (2 * PLAN_DECEL) + 10);
        target = Math.min(this.speedKmh / 3.6, this.params.maxForwardSpeed * 0.9, this.planner.safeSpeed(horizon, PLAN_DECEL));
        // 先に障害物があれば、通れる横の位置を探してよける
        if (!pushing) this.planAvoidance(car, sense, v);
        blocked = !pushing && this.senseAlongRoute(car, sense, stopDistance, this.targetShift()) !== null;
      } else {
        // 自由に走るときは、曲がるときも含めて言われた速さのまま（止まるのはぶつかりそうなときだけ）
        target = Math.min(this.speedKmh / 3.6, this.params.maxForwardSpeed * 0.9);
        const err = wrapAngle(this.freeHeading - car.yaw);
        const hit = pushing ? null : sense(car.yaw + Math.max(-0.5, Math.min(0.5, err)), stopDistance);
        blocked = hit !== null && hit < stopDistance;
      }
      if (blocked && !this.obstacleAhead) this.events.push({ type: 'obstacle' });
      this.obstacleAhead = blocked;
      if (blocked) target = 0;
      if (pushing) target = Math.min(target, 2);

      this.maybeSuddenBrake(dt, v);
      if (this.time < this.suddenBrakeUntil) target = 0;
    }

    this.updateShift(dt, v);
    const input = this.speedControl(target, v);
    const steer = this.modeValue === 'route' ? this.steering(car) : this.freeSteering(car);
    input.steer = this.stateValue === 'parked' && Math.abs(v) < 0.3 ? 0 : steer;

    if ((this.stateValue === 'stopping' || this.stateValue === 'panic') && Math.abs(v) < 0.3) {
      this.stateValue = 'parked';
      this.events.push({ type: 'stopped' });
    }
    return input;
  }

  private execute(command: Command, options: CommandOptions = {}, acked = false): void {
    const ack = (extra: Partial<Extract<DriverEvent, { type: 'ack' }>> = {}) => {
      if (!acked) this.events.push({ type: 'ack', command, ...extra });
    };
    const free = this.modeValue === 'free';
    const drive = () => {
      if (this.stateValue !== 'driving') this.stateValue = 'driving';
    };
    const degrees = (fallback: number) => ((options.angleDeg ?? fallback) * Math.PI) / 180;

    switch (command) {
      case 'start':
        if (this.obstacleAhead) this.pushThroughUntil = this.time + 3;
        this.stateValue = 'driving';
        ack();
        break;
      case 'faster':
        this.speedLevel = Math.min(SPEED_LEVELS_KMH.length - 1, this.speedLevel + 1);
        drive();
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
      case 'turnRight':
      case 'goLeft':
      case 'goRight':
      case 'steerLeft':
      case 'steerRight': {
        // 聞き間違えると逆の方向だと思い込む（返事で気づけるように、言い間違えたまま返事する）。時間指定の指示は返事で確かめ済み
        const misheard = !acked && this.rng() < this.personality.mishearChance;
        const heard = misheard ? MIRROR[command]! : command;
        const turn = TURN_OF[heard]!;
        // 道なりに走っているときの「次を右」「右」は交差点で曲がる（「右」だけなら、すぐ先に交差点があるときだけ）
        const go = heard === 'goLeft' || heard === 'goRight';
        const reach = this.turnReachDistance(go ? GO_DECEL : PLAN_DECEL);
        const atJunction =
          !free &&
          options.angleDeg === undefined &&
          (heard === 'turnLeft' || heard === 'turnRight' || (go && this.planner.canTurnWithin(turn, reach, GO_JUNCTION_RANGE)));
        if (atJunction) this.planner.setTurn(turn, reach);
        else this.turnFree((turn === 'left' ? 1 : -1) * degrees(FREE_TURN_DEG));
        if (!acked) this.events.push({ type: 'ack', command: heard, misheard });
        break;
      }
      case 'straight':
        if (free) {
          // ハンドルを戻して、いま向いている方へまっすぐ
          this.freeHeading = this.lastYaw;
          this.returnTarget = null;
          this.followAfterReturn = false;
        } else {
          this.planner.setTurn('straight', this.turnReachDistance());
        }
        ack();
        break;
      case 'uturn':
        if (free || !this.planner.uturn(this.turnReachDistance())) this.turnFree(Math.PI);
        drive();
        ack();
        break;
      case 'shiftLeft':
      case 'shiftRight':
        if (free) {
          this.turnFree((command === 'shiftLeft' ? 1 : -1) * degrees(FREE_NUDGE_DEG));
        } else {
          this.userShift = Math.max(SHIFT_MIN, Math.min(SHIFT_MAX, this.userShift + SHIFT_OF[command]!));
        }
        ack();
        break;
      case 'keepLane':
      case 'returnToRoad':
        if (free) {
          this.returnTarget = this.nearestRoadPoint();
          this.followAfterReturn = false;
        } else {
          this.userShift = 0;
        }
        ack();
        break;
      case 'followRoad':
        if (free && !this.startFollowing()) {
          // 道路の上にいなければ、まず近くの道路へ向かう
          this.returnTarget = this.nearestRoadPoint();
          this.followAfterReturn = true;
        }
        drive();
        ack();
        break;
      case 'correctLeft':
      case 'correctRight': {
        if (free) {
          this.turnFree((command === 'correctLeft' ? 1 : -1) * degrees(FREE_TURN_DEG));
          ack();
          break;
        }
        const result = this.planner.correct(TURN_OF[command]!);
        if (result === 'tooLate') this.events.push({ type: 'tooLate' });
        else ack();
        break;
      }
    }
  }

  /** 経路に沿って走れるか確かめ、経路を進める。道路の上にいなければ false */
  private followRoute(car: CarSnapshot): boolean {
    if (!this.localized) {
      this.localized = this.planner.localize(car.x, car.z, car.yaw);
      if (!this.localized) return false;
    }
    const commit = Math.max(25, car.forwardSpeed * 3 + 15);
    if (!this.planner.update(car.x, car.z, commit)) {
      this.localized = this.planner.localize(car.x, car.z, car.yaw);
      if (!this.localized || !this.planner.update(car.x, car.z, commit)) {
        this.localized = false;
        return false;
      }
    }
    this.handlePlannerEvents();
    return true;
  }

  /** 経路を離れて、heading の向きへ自由に走り始める */
  private enterFree(heading: number, announce: boolean): void {
    this.modeValue = 'free';
    this.localized = false;
    this.freeHeading = heading;
    this.returnTarget = null;
    this.followAfterReturn = false;
    this.avoidShift = null;
    this.shift = 0;
    if (announce) this.events.push({ type: 'offRoad' });
  }

  /** いまの向きから angle [rad] 向きを変える（左が +）。道なりに走っていたら、道なりをやめる */
  private turnFree(angle: number): void {
    if (this.modeValue === 'route') this.enterFree(this.lastYaw, false);
    this.freeHeading += angle;
    this.returnTarget = null;
    this.followAfterReturn = false;
  }

  /** 「道に戻って」の行き先へ向かう。着いたら道路の向き（いまの向きに近いほう）にそろえる */
  private steerFree(car: CarSnapshot): void {
    if (!this.returnTarget) return;
    const dx = this.returnTarget.x - car.x;
    const dz = this.returnTarget.z - car.z;
    this.freeHeading = car.yaw + wrapAngle(Math.atan2(dx, dz) - car.yaw);
    if (Math.hypot(dx, dz) > 5) return;
    this.returnTarget = null;
    if (this.followAfterReturn && this.startFollowing()) return;
    this.followAfterReturn = false;
    const tile = this.map.tileAt(Math.round(car.x / this.map.def.tileSize), Math.round(car.z / this.map.def.tileSize));
    const dirs = tile?.connections ?? [];
    if (dirs.length) {
      const best = [...dirs].sort(
        (a, b) => Math.abs(wrapAngle(DIR_YAW[a] - car.yaw)) - Math.abs(wrapAngle(DIR_YAW[b] - car.yaw)),
      )[0];
      this.freeHeading = car.yaw + wrapAngle(DIR_YAW[best] - car.yaw);
    }
    this.events.push({ type: 'rejoin' });
  }

  /** 道路の上にいれば、道なりに走り始める */
  private startFollowing(): boolean {
    const { x, z } = this.lastPos;
    if (!this.planner.localize(x, z, this.lastYaw)) return false;
    this.localized = true;
    this.modeValue = 'route';
    this.userShift = 0;
    this.returnTarget = null;
    this.followAfterReturn = false;
    return true;
  }

  /** いちばん近い道路タイルの中心 */
  private nearestRoadPoint(): { x: number; z: number } | null {
    const here = this.lastPos;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const t of this.map.tiles) {
      if (t.kind !== 'road') continue;
      const c = tileCenter(this.map, t.col, t.row);
      const d = Math.hypot(c.x - here.x, c.z - here.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** 自由に走るときのハンドル: 向かう向きとのずれに比例して切る */
  private freeSteering(car: CarSnapshot): number {
    const err = wrapAngle(this.freeHeading - car.yaw);
    const steer = err * 2.2 + this.wobble() * 0.5;
    return Math.max(-1, Math.min(1, steer));
  }

  private wobble(): number {
    return (
      this.personality.steerWobble *
      (Math.sin(this.time * 1.3 + this.wobblePhase) + 0.5 * Math.sin(this.time * 3.1 + this.wobblePhase * 2))
    );
  }

  private handlePlannerEvents(): void {
    for (const e of this.planner.drainEvents()) {
      if (e.type === 'autoTurn') {
        if (this.stateValue === 'driving') this.events.push({ type: 'autoTurn', turn: e.turn });
      } else if (e.type === 'enterUturn') {
        this.events.push({ type: 'uturning' });
      } else if (e.type === 'enterJunction') {
        if (e.mistaken) this.events.push({ type: 'wrongTurn' });
        else if (e.turn !== 'straight') this.events.push({ type: 'turning', turn: e.turn });
      }
    }
  }

  /** 今の速さから、曲がれる速さまで無理なく落とせる距離 [m]。これより先の交差点なら指示に間に合う */
  private turnReachDistance(decel = PLAN_DECEL): number {
    const v = Math.max(0, this.lastSpeed);
    const brake = Math.max(0, v * v - TURN_ENTRY_SPEED * TURN_ENTRY_SPEED) / (2 * decel);
    return brake + 3;
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

  /** ハンドルで目指す横のずれ（よけている間はそちらを優先） */
  private targetShift(): number {
    return this.avoidShift ?? this.userShift;
  }

  /**
   * 障害物をよける位置を決める。いまの走行ラインの先に障害物があれば、通れる横の位置へずらす。
   * 通り過ぎたら元の位置へ戻る（戻る先がまだふさがっていれば、もう少しそのまま進む）。
   */
  private planAvoidance(car: CarSnapshot, sense: ObstacleSensor, v: number): void {
    const probe = Math.max(14, v * 1.8 + 8);
    if (this.avoidShift !== null && this.travelled > this.avoidUntil) {
      if (this.senseAlongRoute(car, sense, probe, this.userShift) === null) this.avoidShift = null;
      else this.avoidUntil = this.travelled + 4;
    }
    const current = this.targetShift();
    const hit = this.senseAlongRoute(car, sense, probe, current);
    if (hit === null) return;
    const candidates = AVOID_SHIFTS.filter((c) => Math.abs(c - current) >= 1).sort(
      (a, b) => Math.abs(a - this.userShift) - Math.abs(b - this.userShift),
    );
    for (const c of candidates) {
      if (this.senseAlongRoute(car, sense, probe, c) !== null) continue;
      if (this.avoidShift === null) this.events.push({ type: 'avoid' });
      this.avoidShift = c;
      this.avoidUntil = this.travelled + hit + AVOID_CLEARANCE;
      return;
    }
  }

  /** 狙う横のずれを目標へなめらかに近づける。性格に応じて、ゆっくり左右に揺らぐ */
  private updateShift(dt: number, v: number): void {
    const wander = Math.min(0.6, this.personality.steerWobble * 6) * Math.sin(this.time * 0.23 + this.wobblePhase * 3);
    const goal = this.targetShift() + (this.avoidShift === null ? wander : 0);
    const rate = (0.8 + 0.25 * Math.abs(v)) * dt;
    this.shift += Math.max(-rate, Math.min(rate, goal - this.shift));
  }

  /** 経路上の距離 s の点を、進行方向の左へ shift [m] ずらした点 */
  private shiftedPoint(s: number, shift: number): { x: number; z: number } {
    const p = this.planner.pointAt(s);
    if (shift === 0) return p;
    const a = this.planner.pointAt(s - 1);
    const b = this.planner.pointAt(s + 1);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // 進行方向 (dx, dz) の左は (dz, -dx)
    return { x: p.x + ((b.z - a.z) / len) * shift, z: p.z - ((b.x - a.x) / len) * shift };
  }

  /** 横に shift ずらした走行ラインの distance [m] 先へ向けて障害物を探し、見つかればその距離 */
  private senseAlongRoute(car: CarSnapshot, sense: ObstacleSensor, distance: number, shift: number): number | null {
    const front = 2.25;
    const target = this.shiftedPoint(this.planner.progress + front + distance, shift);
    const yaw = Math.atan2(target.x - car.x, target.z - car.z);
    const hit = sense(yaw, distance);
    return hit !== null && hit < distance ? hit : null;
  }

  /** Pure Pursuit: 少し先の経路上の点へ向かうように舵を切る */
  private steering(car: CarSnapshot): number {
    const v = Math.max(0, car.forwardSpeed);
    const lookahead = Math.min(12, Math.max(4, 3 + v * 0.6));
    const target = this.shiftedPoint(this.planner.progress + lookahead, this.shift);
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const dx = target.x - car.x;
    const dz = target.z - car.z;
    const forward = dx * fx + dz * fz;
    const left = dx * fz - dz * fx;
    const alpha = Math.atan2(left, forward);
    const delta = Math.atan((2 * this.params.wheelBase * Math.sin(alpha)) / lookahead);
    const steer = delta / steerLimitAt(Math.max(v, 0.1), this.params) + this.wobble();
    return Math.max(-1, Math.min(1, steer));
  }
}
