import * as THREE from 'three';
import { CAR_DIMENSIONS, type CarSnapshot } from '../sim/car';

/** 箱を組み合わせた簡易な乗用車モデル。前輪の舵角とタイヤの回転を反映する */
export class CarMesh {
  readonly root = new THREE.Group();
  private readonly frontPivots: THREE.Group[] = [];
  private readonly wheels: THREE.Mesh[] = [];

  constructor(color = 0xd94141) {
    const { width, length, wheelRadius, frontAxle, rearAxle, track } = CAR_DIMENSIONS;
    const paint = new THREE.MeshLambertMaterial({ color });
    const glass = new THREE.MeshLambertMaterial({ color: 0x23303d });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d1d1f });

    const lower = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, length), paint);
    lower.position.y = wheelRadius + 0.2;
    lower.castShadow = true;
    this.root.add(lower);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.5, length * 0.5), glass);
    cabin.position.set(0, wheelRadius + 0.72, -0.15);
    cabin.castShadow = true;
    this.root.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.88, 0.06, length * 0.46), paint);
    roof.position.set(0, wheelRadius + 1.0, -0.15);
    this.root.add(roof);

    const lightGeo = new THREE.BoxGeometry(0.4, 0.14, 0.05);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d5 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xc81e1e });
    for (const s of [-1, 1]) {
      const head = new THREE.Mesh(lightGeo, headMat);
      head.position.set(s * (width / 2 - 0.3), wheelRadius + 0.3, length / 2 + 0.01);
      this.root.add(head);
      const tail = new THREE.Mesh(lightGeo, tailMat);
      tail.position.set(s * (width / 2 - 0.3), wheelRadius + 0.3, -length / 2 - 0.01);
      this.root.add(tail);
    }

    // タイヤ: 回転が見えるようにホイールキャップを中心からずらして付ける
    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.28, 16).rotateZ(Math.PI / 2);
    const capGeo = new THREE.BoxGeometry(0.3, wheelRadius * 0.9, 0.12);
    const capMat = new THREE.MeshLambertMaterial({ color: 0xb0b4ba });
    for (const z of [frontAxle, rearAxle]) {
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * track, wheelRadius, z);
        const wheel = new THREE.Mesh(tireGeo, dark);
        wheel.castShadow = true;
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.x = s * 0.05;
        wheel.add(cap);
        pivot.add(wheel);
        this.root.add(pivot);
        this.wheels.push(wheel);
        if (z === frontAxle) this.frontPivots.push(pivot);
      }
    }
  }

  update(s: CarSnapshot): void {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(0, s.yaw, 0);
    for (const p of this.frontPivots) p.rotation.y = s.steerAngle;
    for (const w of this.wheels) w.rotation.x = s.wheelSpin;
  }
}
