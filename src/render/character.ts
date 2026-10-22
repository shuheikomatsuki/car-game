import * as THREE from 'three';
import type { Mood } from '../ai/dialogue';
import type { FaceMeshData } from '../face/shape';
import { CABIN, SEAT_Y } from './carMesh';

export const HEAD_RADIUS = 0.1;
/** 後ろ髪の傾き（顔写真のときは額が見えるよう後ろへ下げる） */
const HAIR_TILT = -0.5;
const HAIR_TILT_WITH_PHOTO = -1.1;

/**
 * 頭の前半分を覆う球面。写真を正面から投影するように UV を付ける
 * （正面から見ると写真どおり、横に回るほど引き伸ばされる）。
 */
function createFaceCap(radius: number): THREE.BufferGeometry {
  // phi 0〜π が +Z（顔の正面）側の半球
  const geo = new THREE.SphereGeometry(radius, 40, 30, 0, Math.PI);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    // 正面から見て右（-X）が画像の右になる
    uv.setXY(i, 0.5 - pos.getX(i) / (2 * radius), 0.5 + pos.getY(i) / (2 * radius));
  }
  return geo;
}

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
  private readonly eyes: THREE.Mesh[] = [];
  private readonly hairBack: THREE.Mesh;
  private readonly faceCap: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  /** 顔写真から読み取った形で作った立体の顔（写真を貼る面の上に重ねる） */
  private faceShape: THREE.Mesh | null = null;
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
    const face = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 16, 12), skin);
    this.head.add(face);
    // 顔写真を貼る面（写真が無いときは隠す）
    this.faceCap = new THREE.Mesh(createFaceCap(HEAD_RADIUS * 1.004), new THREE.MeshLambertMaterial());
    this.faceCap.visible = false;
    this.head.add(this.faceCap);
    // 髪: 頭頂から後ろを覆う半球 + 後ろ髪
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.113, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    back.rotation.x = HAIR_TILT;
    this.head.add(back);
    this.hairBack = back;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), hair);
    tail.position.set(0, -0.08, -0.1);
    this.head.add(tail);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eye);
      e.position.set(s * 0.036, 0.01, 0.092);
      this.head.add(e);
      this.eyes.push(e);
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

  /** 顔写真（composeFaceTexture で作ったもの）を貼る。null で元の顔に戻す */
  setFace(image: HTMLCanvasElement | HTMLImageElement | null): void {
    const material = this.faceCap.material;
    material.map?.dispose();
    material.map = null;
    if (image) {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      material.map = texture;
      // 車内の暗さで顔がつぶれないよう、少しだけ自ら光らせる
      material.emissiveMap = texture;
      material.emissive.setRGB(1, 1, 1);
      material.emissiveIntensity = 0.3;
    } else {
      material.emissiveMap = null;
      material.emissive.setRGB(0, 0, 0);
    }
    material.needsUpdate = true;
    const has = image !== null;
    this.faceCap.visible = has;
    if (this.faceShape) this.faceShape.visible = has;
    for (const e of this.eyes) e.visible = !has;
    this.hairBack.rotation.x = has ? HAIR_TILT_WITH_PHOTO : HAIR_TILT;
  }

  /** 顔の立体（buildFaceMesh で作ったもの）を付ける。null で外す（写真は球面に貼ったまま） */
  setFaceShape(data: FaceMeshData | null): void {
    if (this.faceShape) {
      this.head.remove(this.faceShape);
      this.faceShape.geometry.dispose();
      this.faceShape = null;
    }
    if (!data) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    // 写真の貼り方・明るさは球面の顔と同じにする
    this.faceShape = new THREE.Mesh(geo, this.faceCap.material);
    this.faceShape.visible = this.faceCap.visible;
    this.head.add(this.faceShape);
  }

  setMood(mood: Mood, talkSeconds: number): void {
    this.mood = mood;
    this.talkingUntil = this.time + talkSeconds;
  }

  update(dt: number, steerAngle: number): void {
    this.time += dt;
    const talking = this.time < this.talkingUntil;
    // 話している間は助手席（+X 側）を少し向く
    const targetYaw = talking && this.mood !== 'panic' ? 0.8 : 0;
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
