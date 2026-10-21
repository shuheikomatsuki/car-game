import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './physics';
import {
  type DriverInput,
  type VehicleParams,
  DEFAULT_VEHICLE_PARAMS,
  stepVehicle,
} from './vehicle';

/** 車体の寸法（衝突体と見た目で共通） */
export const CAR_DIMENSIONS = {
  width: 1.9,
  length: 4.4,
  height: 1.1,
  wheelRadius: 0.36,
  /** 前輪・後輪の前後位置 */
  frontAxle: 1.35,
  rearAxle: -1.25,
  /** 左右のタイヤ位置 */
  track: 0.82,
};

/** 描画・カメラ・HUD・将来のネットワーク同期で使う、シリアライズ可能な車の状態 */
export interface CarSnapshot {
  x: number;
  y: number;
  z: number;
  /** ヨー角 [rad]（前方 +Z を 0 とし、左回りが正） */
  yaw: number;
  /** 前後方向の速度 [m/s] */
  forwardSpeed: number;
  /** 左右方向の速度 [m/s]（横滑り） */
  lateralSpeed: number;
  /** 舵角 [rad] */
  steerAngle: number;
  /** タイヤの回転角 [rad] */
  wheelSpin: number;
}

/**
 * 物理ワールド内の1台の車。
 * 毎ステップ、剛体の速度を読み取り → 車両モデルで次の速度を計算 → 剛体に書き戻す。
 * 衝突による減速・停止は物理エンジンが解決し、次のステップで読み取る速度に反映される。
 */
export class Car {
  readonly body: RAPIER.RigidBody;
  params: VehicleParams;
  private steerAngle = 0;
  private wheelSpin = 0;
  /** 直前のステップで剛体に指示した水平速度（衝突の強さを測るため） */
  private commanded = { x: 0, z: 0 };

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: { x: number; z: number; yaw: number },
    params: VehicleParams = DEFAULT_VEHICLE_PARAMS,
  ) {
    const { rapier, world } = physics;
    const { width, length, height } = CAR_DIMENSIONS;
    this.params = { ...params };
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        // MVPでは横転させない（ヨー回転のみ許可）
        .enabledRotations(false, true, false)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    world.createCollider(
      rapier.ColliderDesc.cuboid(width / 2, height / 2, length / 2)
        // 車体の下端を剛体の原点（地面）に合わせる
        .setTranslation(0, height / 2 + 0.05, 0)
        .setMass(1200)
        // タイヤの摩擦は車両モデル側で扱うので、衝突体の摩擦はゼロにする（壁に沿って滑る）
        .setFriction(0)
        .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
        .setRestitution(0.1),
      this.body,
    );
    this.reset(spawn);
  }

  reset(spawn: { x: number; z: number; yaw: number }): void {
    this.body.setTranslation({ x: spawn.x, y: 0.05, z: spawn.z }, true);
    this.body.setRotation(yawToQuat(spawn.yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.commanded = { x: 0, z: 0 };
  }

  /** 物理ステップの前に呼ぶ */
  applyInput(input: DriverInput, dt: number): void {
    const yaw = quatToYaw(this.body.rotation());
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // 左方向 = 前方を +90° 回したもの
    const lx = fz;
    const lz = -fx;

    const vel = this.body.linvel();
    const forwardSpeed = vel.x * fx + vel.z * fz;
    const lateralSpeed = vel.x * lx + vel.z * lz;

    const next = stepVehicle(
      { forwardSpeed, lateralSpeed, steerAngle: this.steerAngle },
      input,
      this.params,
      dt,
    );

    this.steerAngle = next.steerAngle;
    this.wheelSpin += (next.forwardSpeed / CAR_DIMENSIONS.wheelRadius) * dt;

    this.commanded = {
      x: fx * next.forwardSpeed + lx * next.lateralSpeed,
      z: fz * next.forwardSpeed + lz * next.lateralSpeed,
    };
    this.body.setLinvel({ x: this.commanded.x, y: vel.y, z: this.commanded.z }, true);
    this.body.setAngvel({ x: 0, y: next.yawRate, z: 0 }, true);
  }

  /**
   * 物理ステップの後に呼ぶ。指示した速度と実際の速度の差から衝突の強さ [m/s] を返す。
   * 壁に押し付けているだけなら小さく、勢いよくぶつかると大きくなる。
   */
  measureImpact(): number {
    const v = this.body.linvel();
    return Math.hypot(this.commanded.x - v.x, this.commanded.z - v.z);
  }

  /** 物理ステップ後の実際の状態（衝突で止まっていれば速度は 0 になる） */
  snapshot(): CarSnapshot {
    const t = this.body.translation();
    const yaw = quatToYaw(this.body.rotation());
    const v = this.body.linvel();
    return {
      x: t.x,
      y: t.y,
      z: t.z,
      yaw,
      forwardSpeed: v.x * Math.sin(yaw) + v.z * Math.cos(yaw),
      lateralSpeed: v.x * Math.cos(yaw) - v.z * Math.sin(yaw),
      steerAngle: this.steerAngle,
      wheelSpin: this.wheelSpin,
    };
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }
}

/** Y軸回転のみのクォータニオンからヨー角を取り出す */
function quatToYaw(q: { x: number; y: number; z: number; w: number }): number {
  return 2 * Math.atan2(q.y, q.w);
}

function yawToQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
