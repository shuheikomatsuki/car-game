import RAPIER from '@dimforge/rapier3d-compat';
import type { MapObstacles } from '../map/obstacles';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/** Rapier（WASM）の初期化。何度呼んでも1回だけ実行される */
export function loadRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export interface ConeBody {
  body: RAPIER.RigidBody;
}

export const CONE_HALF_SIZE = { radius: 0.25, height: 0.4 };

export interface PhysicsWorld {
  rapier: Rapier;
  world: RAPIER.World;
  cones: ConeBody[];
}

/** 地面・建物・壁・木・コーンの衝突体を持つ物理ワールドを作る */
export function createPhysicsWorld(rapier: Rapier, obstacles: MapObstacles): PhysicsWorld {
  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });

  // 地面（十分に広い板）
  const ground = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(rapier.ColliderDesc.cuboid(2000, 0.5, 2000), ground);

  for (const b of obstacles.boxes) {
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z));
    world.createCollider(rapier.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(0.1), body);
  }

  for (const t of obstacles.trees) {
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(t.x, t.height / 2, t.z),
    );
    world.createCollider(rapier.ColliderDesc.cylinder(t.height / 2, t.trunkRadius), body);
  }

  const cones = obstacles.cones.map((c) => {
    const { radius, height } = CONE_HALF_SIZE;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(c.x, height, c.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5),
    );
    world.createCollider(
      rapier.ColliderDesc.cylinder(height, radius).setMass(4).setFriction(0.6),
      body,
    );
    return { body };
  });

  return { rapier, world, cones };
}
