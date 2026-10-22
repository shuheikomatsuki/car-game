import * as THREE from 'three';
import type { CarSnapshot } from '../sim/car';
import { CABIN } from './carMesh';

export type CameraModeId = 'chaseNear' | 'chaseFar' | 'driver';

type CameraMode =
  | { id: CameraModeId; kind: 'chase'; name: string; distance: number; height: number }
  /** lookYaw: 正面からどれだけ視線をずらすか [rad]（負で右）。lookDrop: 10m 先で視線をどれだけ下げるか [m] */
  | { id: CameraModeId; kind: 'cabin'; name: string; eye: THREE.Vector3; lookYaw: number; lookDrop?: number; fov?: number };

const MODES: CameraMode[] = [
  { id: 'chaseNear', kind: 'chase', name: '三人称（近）', distance: 7, height: 2.6 },
  { id: 'chaseFar', kind: 'chase', name: '三人称（遠）', distance: 13, height: 5.5 },
  { id: 'driver', kind: 'cabin', name: '運転席', eye: CABIN.driverEye, lookYaw: 0 },
];

const CHASE_FOV = 65;
const CABIN_FOV = 72;

/** 視点の切り替えと追従。三人称は滑らかに追いかけ、車内視点は車に固定する */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private modeIndex = 0;
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private orbitAngle = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CHASE_FOV, aspect, 0.3, 1500);
  }

  get modeName(): string {
    return MODES[this.modeIndex].name;
  }

  get modeId(): CameraModeId {
    return MODES[this.modeIndex].id;
  }

  /** 次の視点へ。skip に含まれる視点は飛ばす（キャラクターがいないときの車内カメラなど） */
  cycle(skip: readonly CameraModeId[] = []): void {
    do {
      this.modeIndex = (this.modeIndex + 1) % MODES.length;
    } while (skip.includes(MODES[this.modeIndex].id));
    this.initialized = false;
  }

  select(id: CameraModeId): void {
    this.modeIndex = MODES.findIndex((m) => m.id === id);
    this.initialized = false;
  }

  /** 即座に目標位置へ移動する（リセット時など） */
  snap(): void {
    this.initialized = false;
  }

  /** 衝突時の揺れ。strength は衝突の強さ [m/s] */
  addShake(strength: number): void {
    this.shake = Math.min(0.5, this.shake + strength * 0.03);
  }

  /**
   * タイトル・メニューの後ろの景色: 止まっている車の周りをゆっくり回って見せる。
   * 走りに戻ったら update で、いまの視点へ滑らかに戻る
   */
  orbit(car: CarSnapshot, frameDt: number): void {
    this.orbitAngle += frameDt * 0.12;
    const a = car.yaw + 2.4 + this.orbitAngle;
    this.position.set(car.x + Math.sin(a) * 7.5, car.y + 2.1, car.z + Math.cos(a) * 7.5);
    this.lookAt.set(car.x, car.y + 0.8, car.z);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    if (this.camera.fov !== 40 || this.camera.near !== 0.3) {
      this.camera.fov = 40;
      this.camera.near = 0.3;
      this.camera.updateProjectionMatrix();
    }
  }

  update(car: CarSnapshot, frameDt: number): void {
    const mode = MODES[this.modeIndex];
    const speed = Math.abs(car.forwardSpeed);
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    let fov: number;
    let near: number;

    if (mode.kind === 'chase') {
      // 速度が上がるほど少し引いて、視野も広げる
      const d = mode.distance + speed * 0.08;
      const targetPos = new THREE.Vector3(car.x - fx * d, car.y + mode.height, car.z - fz * d);
      const targetLook = new THREE.Vector3(car.x + fx * 3, car.y + 1.2, car.z + fz * 3);
      if (!this.initialized) {
        this.position.copy(targetPos);
        this.lookAt.copy(targetLook);
        this.initialized = true;
      } else {
        // フレームレートに依存しない指数平滑化
        this.position.lerp(targetPos, 1 - Math.exp(-6 * frameDt));
        this.lookAt.lerp(targetLook, 1 - Math.exp(-12 * frameDt));
      }
      fov = CHASE_FOV + Math.min(speed, 30) * 0.3;
      near = 0.3;
    } else {
      // 車体ローカル座標の目の位置をワールド座標へ（前方 +Z、左 +X）
      const { x: ex, y: ey, z: ez } = mode.eye;
      this.position.set(car.x + ex * fz + ez * fx, car.y + ey, car.z - ex * fx + ez * fz);
      const lx = Math.sin(car.yaw + mode.lookYaw);
      const lz = Math.cos(car.yaw + mode.lookYaw);
      this.lookAt.set(this.position.x + lx * 10, this.position.y - (mode.lookDrop ?? 0.7), this.position.z + lz * 10);
      fov = (mode.fov ?? CABIN_FOV) + Math.min(speed, 30) * 0.15;
      near = 0.05;
    }

    this.camera.position.copy(this.position);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-8 * frameDt);
    }
    this.camera.lookAt(this.lookAt);

    if (Math.abs(this.camera.fov - fov) > 0.01 || this.camera.near !== near) {
      this.camera.fov = fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }
}
