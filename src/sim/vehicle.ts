/**
 * 車両の運動モデル（物理エンジン・描画に依存しない純粋なロジック）。
 *
 * 車体ローカル座標での速度（前後・左右）と舵角を受け取り、
 * 1ステップ後の速度・舵角・ヨーレートを返す。
 * 衝突は物理エンジン側が解決し、その結果の速度が次のステップの入力になる。
 *
 * 座標系: 前方 = +Z、左 = +X、上 = +Y。steer > 0 で左に曲がる。
 */

/** 手動運転・AI・ネットワークで共通の運転入力 */
export interface DriverInput {
  /** アクセル 0..1 */
  throttle: number;
  /** ブレーキ 0..1（停止付近で踏み続けると後退） */
  brake: number;
  /** ハンドル -1（右）..1（左） */
  steer: number;
}

export const NEUTRAL_INPUT: Readonly<DriverInput> = { throttle: 0, brake: 0, steer: 0 };

export interface VehicleParams {
  /** 前進の最高速度 [m/s] */
  maxForwardSpeed: number;
  /** 後退の最高速度 [m/s] */
  maxReverseSpeed: number;
  /** 発進時の加速度 [m/s^2]（最高速に近づくほど弱まる） */
  engineAccel: number;
  /** 後退時の加速度 [m/s^2] */
  reverseAccel: number;
  /** ブレーキの減速度 [m/s^2] */
  brakeDecel: number;
  /** アクセルを離したときの減速度 [m/s^2] */
  coastDecel: number;
  /** 空気抵抗係数（減速度 = dragCoef * v^2） */
  dragCoef: number;
  /** ホイールベース [m] */
  wheelBase: number;
  /** 最大舵角 [rad] */
  maxSteerAngle: number;
  /** ハンドルを切る速さ [rad/s] */
  steerRate: number;
  /** ハンドルが中央に戻る速さ [rad/s] */
  steerReturnRate: number;
  /** 旋回時の横加速度の上限 [m/s^2]（高速ほど舵角が自動で絞られる） */
  maxLateralAccel: number;
  /** 横滑りの減衰率 [1/s]（大きいほどグリップが強い） */
  lateralGrip: number;
}

export const DEFAULT_VEHICLE_PARAMS: Readonly<VehicleParams> = {
  maxForwardSpeed: 30,
  maxReverseSpeed: 7,
  engineAccel: 10,
  reverseAccel: 4,
  brakeDecel: 16,
  coastDecel: 0.8,
  dragCoef: 0.0015,
  wheelBase: 2.6,
  maxSteerAngle: 0.6,
  steerRate: 2.2,
  steerReturnRate: 3.5,
  maxLateralAccel: 14,
  lateralGrip: 8,
};

export interface VehiclePreset {
  /** 変わらない id（ランキングの区別に使う）。表示名 label は変えてもよい */
  id: string;
  label: string;
  /** メニューに出す短い説明 */
  description: string;
  params: Readonly<VehicleParams>;
}

/** 選べる車（P キーで切り替え） */
export const VEHICLE_PRESETS: readonly VehiclePreset[] = [
  { id: 'standard', label: '普通車', description: '扱いやすいふつうの車', params: DEFAULT_VEHICLE_PARAMS },
  {
    id: 'kei',
    label: '軽自動車',
    description: '遅いけれど小回りがきく',
    params: { ...DEFAULT_VEHICLE_PARAMS, maxForwardSpeed: 24, engineAccel: 7, brakeDecel: 14, wheelBase: 2.4, maxLateralAccel: 12 },
  },
  {
    id: 'sport',
    label: 'スポーツカー',
    description: '速くて曲がる、くせのない車',
    params: {
      ...DEFAULT_VEHICLE_PARAMS,
      maxForwardSpeed: 55,
      engineAccel: 17,
      brakeDecel: 22,
      dragCoef: 0.0008,
      steerRate: 2.6,
      maxLateralAccel: 18,
      lateralGrip: 10,
    },
  },
  {
    id: 'ae86',
    label: 'AE86',
    description: 'FR・軽い。直線は遅いがコーナーは速い',
    params: {
      ...DEFAULT_VEHICLE_PARAMS,
      maxForwardSpeed: 47,
      engineAccel: 13,
      brakeDecel: 23,
      dragCoef: 0.0011,
      wheelBase: 2.4,
      maxSteerAngle: 0.62,
      steerRate: 2.9,
      steerReturnRate: 3.8,
      maxLateralAccel: 20,
      lateralGrip: 9.5,
    },
  },
  {
    id: 'fd3s',
    label: 'RX-7 (FD3S)',
    description: 'FR・ロータリーターボ。速いがお尻が流れやすい',
    params: {
      ...DEFAULT_VEHICLE_PARAMS,
      maxForwardSpeed: 58,
      engineAccel: 17.5,
      brakeDecel: 21,
      dragCoef: 0.0008,
      wheelBase: 2.43,
      steerRate: 2.8,
      maxLateralAccel: 17.5,
      lateralGrip: 8,
    },
  },
  {
    id: 'evo',
    label: 'ランエボ',
    description: '4WD・ターボ。立ち上がりの加速とグリップが強い',
    params: {
      ...DEFAULT_VEHICLE_PARAMS,
      maxForwardSpeed: 54,
      engineAccel: 19.5,
      brakeDecel: 22,
      dragCoef: 0.0009,
      wheelBase: 2.5,
      steerRate: 2.5,
      maxLateralAccel: 17.5,
      lateralGrip: 11.5,
    },
  },
  {
    id: 'gtr',
    label: 'GT-R (R32)',
    description: '4WD・ツインターボ。最高速がいちばん高いが重い',
    params: {
      ...DEFAULT_VEHICLE_PARAMS,
      maxForwardSpeed: 61,
      engineAccel: 19,
      brakeDecel: 20,
      dragCoef: 0.0007,
      wheelBase: 2.62,
      steerRate: 2.3,
      maxLateralAccel: 17,
      lateralGrip: 11,
    },
  },
];

export interface VehicleState {
  /** 前後方向の速度 [m/s]（前進が正） */
  forwardSpeed: number;
  /** 左右方向の速度 [m/s]（左が正） */
  lateralSpeed: number;
  /** 現在の舵角 [rad]（左が正） */
  steerAngle: number;
}

export interface VehicleStepResult extends VehicleState {
  /** ヨーレート [rad/s]（上から見て反時計回り＝左旋回が正） */
  yawRate: number;
}

/** この速度未満では「止まっている」とみなし、ブレーキ入力を後退として扱う */
const STOP_THRESHOLD = 0.5;

/** 速度に応じた舵角の上限。低速では最大舵角、高速では横加速度が上限を超えないよう絞る */
export function steerLimitAt(speed: number, p: VehicleParams): number {
  const v2 = speed * speed;
  if (v2 < 1e-6) return p.maxSteerAngle;
  return Math.min(p.maxSteerAngle, Math.atan((p.maxLateralAccel * p.wheelBase) / v2));
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** 速度を 0 に向けて amount だけ減らす（0 を超えて反転させない） */
function decelerate(speed: number, amount: number): number {
  if (speed > 0) return Math.max(0, speed - amount);
  return Math.min(0, speed + amount);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function stepVehicle(
  state: VehicleState,
  rawInput: DriverInput,
  p: VehicleParams,
  dt: number,
): VehicleStepResult {
  const throttle = clamp(rawInput.throttle, 0, 1);
  const brake = clamp(rawInput.brake, 0, 1);
  const steer = clamp(rawInput.steer, -1, 1);

  // --- 前後方向 ---
  let v = state.forwardSpeed;
  const movingForward = v > STOP_THRESHOLD;
  const movingBackward = v < -STOP_THRESHOLD;

  if (throttle > 0 && !movingBackward) {
    // 前進加速（最高速に近いほど弱まる）
    const headroom = Math.max(0, 1 - v / p.maxForwardSpeed);
    v += throttle * p.engineAccel * headroom * dt;
  } else if (throttle > 0 && movingBackward) {
    // 後退中のアクセルはブレーキとして働く
    v = decelerate(v, throttle * p.brakeDecel * dt);
  }

  if (brake > 0 && !movingForward && throttle === 0) {
    // 停止中・後退中のブレーキは後退
    const headroom = Math.max(0, 1 + v / p.maxReverseSpeed);
    v -= brake * p.reverseAccel * headroom * dt;
  } else if (brake > 0 && movingForward) {
    v = decelerate(v, brake * p.brakeDecel * dt);
  }

  // 抵抗（転がり抵抗 + 空気抵抗）
  const resistance = (throttle === 0 && brake === 0 ? p.coastDecel : 0) + p.dragCoef * v * v;
  v = decelerate(v, resistance * dt);

  // --- ハンドル ---
  const limit = steerLimitAt(v, p);
  const targetSteer = steer * limit;
  // 高速では舵角の上限が小さいので、切る速さも合わせて落とす（キーボードでも急に曲がりすぎない）
  const rateScale = Math.max(0.35, limit / p.maxSteerAngle);
  const rate = (steer === 0 ? p.steerReturnRate : p.steerRate) * rateScale;
  let steerAngle = approach(state.steerAngle, targetSteer, rate * dt);
  steerAngle = clamp(steerAngle, -limit, limit);

  // --- 旋回（自転車モデル） ---
  const yawRate = (v * Math.tan(steerAngle)) / p.wheelBase;

  // --- 横滑り（タイヤのグリップで減衰） ---
  const lateralSpeed = state.lateralSpeed * Math.exp(-p.lateralGrip * dt);

  return { forwardSpeed: v, lateralSpeed, steerAngle, yawRate };
}
