import * as THREE from 'three';
import { buildObstacles } from '../map/obstacles';
import { CLIFF_START, type Terrain, buildTerrain } from '../map/terrain';
import { DIR_YAW, type MapDefinition, type ParsedMap, parseMap, tileCenter } from '../map/tilemap';
import { type Course, buildCourse } from '../race/course';
import { buildMapMesh, createConeMesh } from '../render/mapMesh';
import { buildRaceLines } from '../render/raceMesh';
import { CAR_DIMENSIONS, Car, type CarSnapshot } from '../sim/car';
import { type PhysicsWorld, type Rapier, createPhysicsWorld } from '../sim/physics';

/** 車体の中心が道路の端からこれ以上外へ出たら、崖から落ちたとみなす [m]（路肩の先の崖の縁） */
const FALL_DISTANCE = CLIFF_START + 0.5;
/** 落ちた車は、落ちた地点からこれだけ手前に戻す [m] */
const RECOVERY_BACK = 8;

/** 1つのマップの物理ワールド・車・描画物をまとめたもの。マップ切り替え時に作り直す */
export class Level {
  readonly physics: PhysicsWorld;
  readonly car: Car;
  readonly map: ParsedMap;
  /** スタート地点（道路の中央） */
  readonly spawn: { x: number; z: number; yaw: number };
  /** レース用のマップなら周回コース */
  readonly course: Course | null;
  /** 高低差のあるマップなら地形 */
  readonly terrain: Terrain | null;
  readonly group = new THREE.Group();
  private readonly coneMeshes: THREE.Mesh[];

  constructor(
    rapier: Rapier,
    readonly def: MapDefinition,
  ) {
    const map = parseMap(def);
    this.map = map;
    const obstacles = buildObstacles(map);
    this.physics = createPhysicsWorld(rapier, obstacles);
    this.terrain = buildTerrain(map);
    const yaw = DIR_YAW[def.start.heading];
    this.spawn = { ...tileCenter(map, def.start.col, def.start.row), yaw };
    this.course = def.race ? buildCourse(map) : null;
    this.car = this.createCar(this.spawn);

    this.group.add(buildMapMesh(map, obstacles, this.terrain));
    if (this.course) this.group.add(buildRaceLines(this.course, this.terrain));
    this.coneMeshes = this.physics.cones.map(() => {
      const m = createConeMesh();
      this.group.add(m);
      return m;
    });
  }

  /** このマップの物理ワールドに車を1台置く（坂道では重力がかかる） */
  createCar(spawn: { x: number; z: number; yaw: number }): Car {
    const car = new Car(this.physics, spawn);
    const terrain = this.terrain;
    if (terrain) car.slope = (x, z) => terrain.gradientAt(x, z);
    if (this.course) {
      // 車体の中心が道路の端にあれば半分、車幅の半分より外ならタイヤがすべて草地
      const half = CAR_DIMENSIONS.width / 2;
      car.offRoad = (x, z) => Math.min(1, Math.max(0, (this.offRoadDistance(x, z)! + half) / (2 * half)));
    }
    return car;
  }

  /** 車体の中心が道路の端から外へ出ている距離 [m]（道路の上なら負）。コースのないマップでは null */
  offRoadDistance(x: number, z: number): number | null {
    if (!this.course) return null;
    return Math.abs(this.course.project(x, z).offset) - this.def.roadWidth / 2;
  }

  /** 道路の外が崖で、はみ出すと落ちるマップ（峠）か */
  get hasCliffs(): boolean {
    return this.terrain !== null && this.course !== null;
  }

  /** 崖から落ちたかどうか（路肩の先の崖の縁を越えた） */
  fellOff(x: number, z: number): boolean {
    return this.hasCliffs && this.offRoadDistance(x, z)! > FALL_DISTANCE;
  }

  /** 落ちた車を戻す位置: 落ちた地点より少し手前の、道路の中央 */
  recoverySpot(x: number, z: number): { x: number; z: number; yaw: number } {
    const course = this.course!;
    const s = course.project(x, z).s - RECOVERY_BACK;
    const p = course.pointAt(course.closed ? s : Math.max(0, s));
    return { x: p.x, z: p.z, yaw: p.yaw };
  }

  /**
   * 物理（平ら）での車の状態を、描画用に地形の上へ載せる。
   * 高さを足し、坂の勾配に合わせて車体を前後・左右に傾ける
   */
  ground(s: CarSnapshot): CarSnapshot {
    if (!this.terrain) return s;
    const g = this.terrain.gradientAt(s.x, s.z);
    const sin = Math.sin(s.yaw);
    const cos = Math.cos(s.yaw);
    return {
      ...s,
      y: s.y + this.terrain.heightAt(s.x, s.z),
      // 前方 (sin, cos)・左 (cos, -sin) の向きの勾配
      pitch: Math.atan(g.x * sin + g.z * cos),
      roll: Math.atan(g.x * cos - g.z * sin),
    };
  }

  /** 動く小物（コーン）の見た目を物理に合わせる */
  syncProps(): void {
    this.physics.cones.forEach((c, i) => {
      const t = c.body.translation();
      const r = c.body.rotation();
      this.coneMeshes[i].position.set(t.x, t.y + (this.terrain?.heightAt(t.x, t.z) ?? 0), t.z);
      this.coneMeshes[i].quaternion.set(r.x, r.y, r.z, r.w);
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    const materials = new Set<THREE.Material>();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => materials.add(m));
      }
    });
    for (const m of materials) {
      if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose();
      m.dispose();
    }
    this.physics.world.free();
  }
}
