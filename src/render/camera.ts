import * as THREE from 'three';
import type { CarSnapshot } from '../sim/car';
import { CABIN } from './carMesh';

type CameraMode =
  | { kind: 'chase'; name: string; distance: number; height: number }
  | { kind: 'cabin'; name: string; eye: THREE.Vector3 };

const MODES: CameraMode[] = [
  { kind: 'chase', name: '三人称（近）', distance: 7, height: 2.6 },
  { kind: 'chase', name: '三人称（遠）', distance: 13, height: 5.5 },
  { kind: 'cabin', name: '運転席', eye: CABIN.driverEye },
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

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CHASE_FOV, aspect, 0.3, 1500);
  }

  get modeName(): string {
    return MODES[this.modeIndex].name;
  }

  cycle(): void {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
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
      this.lookAt.set(this.position.x + fx * 10, this.position.y - 0.7, this.position.z + fz * 10);
      fov = CABIN_FOV + Math.min(speed, 30) * 0.15;
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
