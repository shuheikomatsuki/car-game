import * as THREE from 'three';
import type { Mood } from '../ai/dialogue';
import { CABIN, SEAT_Y } from './carMesh';

/** 肩からハンドルへ下向きに伸ばす腕の角度 */
const ARM_PITCH = 0.4;

/**
 * 運転席に座るキャラクター（簡易な人形）。車の root に add して使う。
 * 話すときは助手席のほうを向き、慌てると頭が震える。
 */
export class CharacterMesh {
  readonly root = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private mood: Mood = 'neutral';
  private talkingUntil = 0;
  private time = 0;

  constructor() {
    const skin = new THREE.MeshLambertMaterial({ color: 0xf2d0b5 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x4a3226 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0xf4f1ea });
    const eye = new THREE.MeshBasicMaterial({ color: 0x2b2b33 });

    this.root.position.set(CABIN.driverEye.x, SEAT_Y, CABIN.driverEye.z + 0.1);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.18), shirt);
    torso.position.set(0, 0.13, -0.05);
    this.root.add(torso);

    this.head.position.set(0, 0.34, 0);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skin);
    this.head.add(face);
    // 髪: 頭頂から後ろを覆う半球 + 後ろ髪
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.113, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    back.rotation.x = -0.5;
    this.head.add(back);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), hair);
    tail.position.set(0, -0.08, -0.1);
    this.head.add(tail);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eye);
      e.position.set(s * 0.036, 0.01, 0.092);
      this.head.add(e);
    }
    this.root.add(this.head);

    // 腕: 肩からハンドルへ
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.16, 0.22, 0);
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.58), shirt);
      limb.position.z = 0.29;
      arm.add(limb);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), skin);
      hand.position.z = 0.6;
      arm.add(hand);
      arm.rotation.x = ARM_PITCH;
      this.arms.push(arm);
      this.root.add(arm);
    }
  }

  setMood(mood: Mood, talkSeconds: number): void {
    this.mood = mood;
    this.talkingUntil = this.time + talkSeconds;
  }

  update(dt: number, steerAngle: number): void {
    this.time += dt;
    const talking = this.time < this.talkingUntil;
    // 話している間は助手席（+X 側）を少し向く
    const targetYaw = talking && this.mood !== 'panic' ? 0.5 : 0;
    this.head.rotation.y += (targetYaw - this.head.rotation.y) * Math.min(1, dt * 6);
    const shake = this.mood === 'panic' && talking ? Math.sin(this.time * 40) * 0.08 : 0;
    const bob = this.mood === 'happy' && talking ? Math.sin(this.time * 10) * 0.05 : 0;
    const droop = this.mood === 'sad' && talking ? 0.25 : 0;
    this.head.rotation.z = shake;
    this.head.rotation.x = -bob + droop;
    // ハンドル操作に合わせて腕を少し上下させる
    this.arms[0].rotation.x = ARM_PITCH + steerAngle * 0.5;
    this.arms[1].rotation.x = ARM_PITCH - steerAngle * 0.5;
    if (!talking && this.mood !== 'neutral') this.mood = 'neutral';
  }
}
