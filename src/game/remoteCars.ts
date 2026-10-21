import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RemoteTrack } from '../net/interpolation';
import type { CarState, PlayerInfo } from '../net/protocol';
import { CarMesh } from '../render/carMesh';
import { CAR_DIMENSIONS, type CarSnapshot } from '../sim/car';
import type { Level } from './level';

/** プレイヤーごとの車体の色（サーバーが番号を割り当てる） */
export const PLAYER_COLORS = [0xd94141, 0x3f7fd9, 0xf2c53d, 0x3fbf6a, 0xf28c28, 0x9b59d0, 0xf0f0f0, 0x2b2d31];
/** これ以上受信が途切れた車は消す [ms] */
const STALE_MS = 3000;

interface RemotePlayer {
  info: PlayerInfo;
  track: RemoteTrack;
  mesh: CarMesh;
  label: THREE.Sprite;
  body: RAPIER.RigidBody | null;
}

function createLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 16);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33, 232);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 2.3;
  return sprite;
}

function toSnapshot(s: CarState): CarSnapshot {
  return { x: s[0], y: 0, z: s[1], yaw: s[2], forwardSpeed: s[3], lateralSpeed: 0, steerAngle: s[4], wheelSpin: s[5] };
}

export function carStateOf(s: CarSnapshot): CarState {
  const r = (v: number, k = 100) => Math.round(v * k) / k;
  return [r(s.x), r(s.z), r(s.yaw, 1000), r(s.forwardSpeed), r(s.steerAngle, 1000), r(s.wheelSpin % (Math.PI * 2), 100)];
}

/**
 * 他のプレイヤーの車。受信した状態を補間して表示し、
 * 自分の物理ワールドには動かせない（キネマティックな）車体として置く（ぶつかると自分の車だけが押し返される）。
 */
export class RemoteCars {
  private readonly players = new Map<number, RemotePlayer>();
  private level: Level | null = null;
  /** この時刻までは他の車とぶつからない（スタート地点に重なって出てきたときのため） */
  private ghostUntil = 0;

  constructor(private readonly scene: THREE.Scene) {}

  get list(): PlayerInfo[] {
    return [...this.players.values()].map((p) => p.info);
  }

  /** マップが変わったら、新しい物理ワールドに車体を作り直す */
  attachLevel(level: Level): void {
    this.level = level;
    for (const p of this.players.values()) p.body = this.createBody();
  }

  add(info: PlayerInfo): void {
    this.remove(info.id);
    const mesh = new CarMesh(PLAYER_COLORS[info.color % PLAYER_COLORS.length]);
    const label = createLabel(info.name);
    mesh.root.add(label);
    mesh.root.visible = false;
    this.scene.add(mesh.root);
    this.players.set(info.id, { info, track: new RemoteTrack(), mesh, label, body: this.createBody() });
  }

  update(info: PlayerInfo): void {
    const p = this.players.get(info.id);
    if (p) p.info = info;
  }

  remove(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.mesh.dispose();
    p.label.material.map?.dispose();
    p.label.material.dispose();
    this.removeBody(p);
    this.players.delete(id);
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  pushState(id: number, time: number, s: CarState, localNow: number): void {
    this.players.get(id)?.track.push(time, s, localNow);
  }

  /** しばらくの間、他の車をすり抜けるようにする */
  ghost(localNow: number, ms = 3000): void {
    this.ghostUntil = localNow + ms;
  }

  /** 物理ステップの前に呼ぶ: 車体を補間した位置へ動かす */
  step(localNow: number): void {
    for (const p of this.players.values()) {
      if (!p.body) continue;
      const s = p.track.sample(localNow);
      const active = s !== null && p.track.silenceMs(localNow) < STALE_MS && localNow >= this.ghostUntil;
      const collider = p.body.collider(0);
      if (collider.isEnabled() !== active) collider.setEnabled(active);
      if (!s || !active) continue;
      p.body.setNextKinematicTranslation({ x: s[0], y: 0, z: s[1] });
      p.body.setNextKinematicRotation({ x: 0, y: Math.sin(s[2] / 2), z: 0, w: Math.cos(s[2] / 2) });
    }
  }

  /** 描画の前に呼ぶ */
  render(localNow: number): void {
    for (const p of this.players.values()) {
      const s = p.track.sample(localNow);
      const visible = s !== null && p.track.silenceMs(localNow) < STALE_MS;
      p.mesh.root.visible = visible;
      if (s && visible) p.mesh.update(toSnapshot(s));
    }
  }

  private createBody(): RAPIER.RigidBody | null {
    if (!this.level) return null;
    const { rapier, world } = this.level.physics;
    const { width, length, height } = CAR_DIMENSIONS;
    const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    world.createCollider(
      rapier.ColliderDesc.cuboid(width / 2, height / 2, length / 2)
        .setTranslation(0, height / 2 + 0.05, 0)
        .setFriction(0),
      body,
    );
    body.collider(0).setEnabled(false);
    return body;
  }

  private removeBody(p: RemotePlayer): void {
    if (p.body && this.level) {
      try {
        this.level.physics.world.removeRigidBody(p.body);
      } catch {
        // マップ切り替えでワールドごと破棄済み
      }
    }
    p.body = null;
  }
}
