import * as THREE from 'three';
import type { CarSnapshot } from '../sim/car';

interface ChaseSetting {
  name: string;
  distance: number;
  height: number;
}

const CHASE_SETTINGS: ChaseSetting[] = [
  { name: '三人称（近）', distance: 7, height: 2.6 },
  { name: '三人称（遠）', distance: 13, height: 5.5 },
];

/** 車の後方から追いかける三人称カメラ */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private settingIndex = 0;
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.3, 1500);
  }

  get modeName(): string {
    return CHASE_SETTINGS[this.settingIndex].name;
  }

  cycle(): void {
    this.settingIndex = (this.settingIndex + 1) % CHASE_SETTINGS.length;
  }

  /** 即座に目標位置へ移動する（リセット時など） */
  snap(): void {
    this.initialized = false;
  }

  update(car: CarSnapshot, frameDt: number): void {
    const { distance, height } = CHASE_SETTINGS[this.settingIndex];
    const speed = Math.abs(car.forwardSpeed);
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    // 速度が上がるほど少し引いて、視野も広げる
    const d = distance + speed * 0.08;

    const targetPos = new THREE.Vector3(car.x - fx * d, car.y + height, car.z - fz * d);
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

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    const fov = 65 + Math.min(speed, 30) * 0.3;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
