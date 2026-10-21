import * as THREE from 'three';
import { buildObstacles } from '../map/obstacles';
import { DIR_YAW, type MapDefinition, parseMap, tileCenter } from '../map/tilemap';
import { buildMapMesh, createConeMesh } from '../render/mapMesh';
import { Car } from '../sim/car';
import { type PhysicsWorld, type Rapier, createPhysicsWorld } from '../sim/physics';

/** 1つのマップの物理ワールド・車・描画物をまとめたもの。マップ切り替え時に作り直す */
export class Level {
  readonly physics: PhysicsWorld;
  readonly car: Car;
  readonly spawn: { x: number; z: number; yaw: number };
  readonly group = new THREE.Group();
  private readonly coneMeshes: THREE.Mesh[];

  constructor(
    rapier: Rapier,
    readonly def: MapDefinition,
  ) {
    const map = parseMap(def);
    const obstacles = buildObstacles(map);
    this.physics = createPhysicsWorld(rapier, obstacles);
    this.spawn = { ...tileCenter(map, def.start.col, def.start.row), yaw: DIR_YAW[def.start.heading] };
    this.car = new Car(this.physics, this.spawn);

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
