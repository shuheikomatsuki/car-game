import * as THREE from 'three';
import { buildObstacles } from '../map/obstacles';
import { DIR_YAW, type MapDefinition, type ParsedMap, parseMap, tileCenter } from '../map/tilemap';
import { buildMapMesh, createConeMesh } from '../render/mapMesh';
import { Car } from '../sim/car';
import { type PhysicsWorld, type Rapier, createPhysicsWorld } from '../sim/physics';
import { type ObstacleSensor, createObstacleSensor } from '../sim/sensors';

/** 1つのマップの物理ワールド・車・描画物をまとめたもの。マップ切り替え時に作り直す */
export class Level {
  readonly physics: PhysicsWorld;
  readonly car: Car;
  readonly map: ParsedMap;
  /** スタート地点（道路の中央） */
  readonly spawn: { x: number; z: number; yaw: number };
  /** スタート地点の左車線（キャラクターが運転するとき） */
  readonly laneSpawn: { x: number; z: number; yaw: number };
  readonly sense: ObstacleSensor;
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
    const yaw = DIR_YAW[def.start.heading];
    this.spawn = { ...tileCenter(map, def.start.col, def.start.row), yaw };
    // 左方向 = (cos yaw, -sin yaw)
    const lane = 3;
    this.laneSpawn = { x: this.spawn.x + Math.cos(yaw) * lane, z: this.spawn.z - Math.sin(yaw) * lane, yaw };
    this.car = new Car(this.physics, this.spawn);
    this.sense = createObstacleSensor(this.physics, this.car);

    this.group.add(buildMapMesh(map, obstacles));
    this.coneMeshes = this.physics.cones.map(() => {
      const m = createConeMesh();
      this.group.add(m);
      return m;
    });
  }

  /** 動く小物（コーン）の見た目を物理に合わせる */
  syncProps(): void {
    this.physics.cones.forEach((c, i) => {
      const t = c.body.translation();
      const r = c.body.rotation();
      this.coneMeshes[i].position.set(t.x, t.y, t.z);
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
