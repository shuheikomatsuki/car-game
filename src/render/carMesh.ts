import * as THREE from 'three';
import { CAR_DIMENSIONS, type CarSnapshot } from '../sim/car';

/** 車内の座標（車体ローカル、前方 +Z・左 +X）。右ハンドルなので運転席は -X 側 */
export const CABIN = {
  driverEye: new THREE.Vector3(-0.4, 1.26, -0.2),
  // 助手席の視点は背もたれ寄りにして、運転席のキャラクターが視界に入るようにする
  passengerEye: new THREE.Vector3(0.38, 1.24, -0.38),
};

/** ハンドルの回転量 / 前輪の舵角（見た目用の比率） */
const STEERING_RATIO = 6;

/** ボディ上面の高さ */
const BELT_Y = CAR_DIMENSIONS.wheelRadius + 0.475;
/** 座面の高さ */
export const SEAT_Y = BELT_Y + 0.11;
const ROOF_Y = 1.42;
/** 窓の形（側面から見た z, y）。後ろ下 → 前下 → 前上 → 後ろ上 */
const WINDOW_PROFILE: [number, number][] = [
  [-1.5, BELT_Y],
  [0.95, BELT_Y],
  [0.4, ROOF_Y],
  [-1.15, ROOF_Y],
];

/** 2点を結ぶ細い棒（ピラーなど） */
function strut(
  mat: THREE.Material,
  x: number,
  from: [number, number],
  to: [number, number],
  thickness = 0.07,
): THREE.Mesh {
  const dz = to[0] - from[0];
  const dy = to[1] - from[1];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, Math.hypot(dz, dy), thickness), mat);
  mesh.position.set(x, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
  mesh.rotation.x = Math.atan2(dz, dy);
  return mesh;
}

/** 箱を組み合わせた簡易な乗用車モデル。前輪の舵角・タイヤの回転・ハンドルの回転を反映する */
export class CarMesh {
  readonly root = new THREE.Group();
  private readonly frontPivots: THREE.Group[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  private readonly steeringWheel = new THREE.Group();

  constructor(color = 0xd94141) {
    const paint = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d1d1f });
    const trim = new THREE.MeshLambertMaterial({ color: 0x2b2d31 });
    this.buildBody(paint, dark);
    this.buildCabin(paint, trim);
    this.buildInterior(trim);
    this.buildWheels(dark);
  }

  private buildBody(paint: THREE.Material, dark: THREE.Material): void {
    const { width, length, wheelRadius } = CAR_DIMENSIONS;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, length), paint);
    lower.position.y = wheelRadius + 0.2;
    lower.castShadow = true;
    this.root.add(lower);

    for (const z of [length / 2, -length / 2]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.2, 0.16), dark);
      bumper.position.set(0, wheelRadius + 0.02, z);
      this.root.add(bumper);
    }

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

      // ドアミラー
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), paint);
      mirror.position.set(s * (width / 2 + 0.08), BELT_Y + 0.12, 0.75);
      this.root.add(mirror);
    }
  }

  private buildCabin(paint: THREE.Material, trim: THREE.Material): void {
    const { width } = CAR_DIMENSIONS;
    const glass = new THREE.MeshPhongMaterial({
      color: 0x9cc3db,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
      shininess: 80,
    });
    const [rearLow, frontLow, frontHigh, rearHigh] = WINDOW_PROFILE;
    const halfW = width / 2 - 0.06;

    // 側面の窓（台形）
    const shape = new THREE.Shape(WINDOW_PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
    const sideGeo = new THREE.ShapeGeometry(shape).rotateY(-Math.PI / 2);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(sideGeo, glass);
      side.position.x = s * halfW;
      this.root.add(side);
    }

    // フロントガラス・リアガラス（傾いた板）
    const slanted = (from: [number, number], to: [number, number]) => {
      const dz = to[0] - from[0];
      const dy = to[1] - from[1];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, Math.hypot(dz, dy)), glass);
      mesh.position.set(0, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
      mesh.rotation.x = Math.atan2(dz, dy);
      this.root.add(mesh);
    };
    slanted(frontLow, frontHigh);
    slanted(rearLow, rearHigh);

    // 屋根とピラー
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.08, 0.06, frontHigh[0] - rearHigh[0] + 0.1),
      paint,
    );
    roof.position.set(0, ROOF_Y + 0.03, (frontHigh[0] + rearHigh[0]) / 2);
    roof.castShadow = true;
    this.root.add(roof);
    // 天井の内張り（車内視点で屋根の裏が暗く見えないように）
    const headliner = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.14, 0.02, frontHigh[0] - rearHigh[0]),
      // 下向きの面は地面の照り返し色（緑）を受けるので、照明の影響を受けない素材にする
      new THREE.MeshBasicMaterial({ color: 0x8f8a82 }),
    );
    headliner.position.set(0, ROOF_Y - 0.01, (frontHigh[0] + rearHigh[0]) / 2);
    this.root.add(headliner);
    for (const s of [-1, 1]) {
      const x = s * halfW;
      this.root.add(strut(paint, x, frontLow, frontHigh, 0.05));
      this.root.add(strut(paint, x, rearLow, rearHigh));
      this.root.add(strut(trim, x, [-0.35, BELT_Y], [-0.35, ROOF_Y], 0.06));
    }
  }

  private buildInterior(trim: THREE.Material): void {
    const { width } = CAR_DIMENSIONS;
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x3b3f47 });

    // 車内の床（ボディ上面の赤が見えないように覆う）
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width - 0.14, 0.02, 2.2), trim);
    floor.position.set(0, BELT_Y + 0.01, -0.45);
    this.root.add(floor);

    const dash = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16, 0.12, 0.3), trim);
    dash.position.set(0, BELT_Y + 0.06, 0.78);
    this.root.add(dash);

    // メーターフード（運転席側）
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.16), trim);
    hood.position.set(CABIN.driverEye.x, BELT_Y + 0.14, 0.68);
    this.root.add(hood);

    for (const x of [CABIN.driverEye.x, CABIN.passengerEye.x]) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatMat);
      cushion.position.set(x, SEAT_Y - 0.06, -0.2);
      this.root.add(cushion);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), seatMat);
      back.position.set(x, BELT_Y + 0.35, -0.5);
      back.rotation.x = -0.15;
      this.root.add(back);
    }
    const rear = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.5, 0.1), seatMat);
    rear.position.set(0, BELT_Y + 0.25, -1.3);
    this.root.add(rear);

    // ハンドル: 少し上向きに傾けたリング + スポーク
    const column = new THREE.Group();
    column.position.set(CABIN.driverEye.x, BELT_Y + 0.08, 0.5);
    column.rotation.x = -0.45;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), trim);
    this.steeringWheel.add(ring);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.02), trim);
    this.steeringWheel.add(spoke);
    const lowerSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.02), trim);
    lowerSpoke.position.y = -0.08;
    this.steeringWheel.add(lowerSpoke);
    column.add(this.steeringWheel);
    this.root.add(column);
  }

  private buildWheels(dark: THREE.Material): void {
    const { wheelRadius, frontAxle, rearAxle, track } = CAR_DIMENSIONS;
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
    // 運転席から見て、左に切るとハンドルは反時計回り
    this.steeringWheel.rotation.z = -s.steerAngle * STEERING_RATIO;
  }
}
