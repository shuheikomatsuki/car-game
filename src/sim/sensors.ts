import type { Car } from './car';
import { CAR_DIMENSIONS } from './car';
import type { PhysicsWorld } from './physics';

const RAY_HEIGHT = 0.6;
const RAY_OFFSETS = [-0.7, 0, 0.7];

/** 方向 yaw・距離 maxDistance で前方を調べ、障害物までの距離 [m] を返す関数 */
export type ObstacleSensor = (yaw: number, maxDistance: number) => number | null;

/**
 * 車のフロントバンパーから指定した向きへ3本のレイを飛ばし、最も近い障害物までの距離 [m] を返す。
 * キャラクター運転では、カーブで外側のガードレールを拾わないよう経路上の点へ向けて使う。
 */
export function createObstacleSensor(physics: PhysicsWorld, car: Car): ObstacleSensor {
  return (yaw, maxDistance) => {
    const { rapier, world } = physics;
    const s = car.snapshot();
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const front = CAR_DIMENSIONS.length / 2 + 0.05;
    let nearest: number | null = null;
    for (const offset of RAY_OFFSETS) {
      // 左方向 = (dz, -dx)
      const origin = {
        x: s.x + fx * front + dz * offset,
        y: s.y + RAY_HEIGHT,
        z: s.z + fz * front - dx * offset,
      };
      const ray = new rapier.Ray(origin, { x: dx, y: 0, z: dz });
      const hit = world.castRay(ray, maxDistance, true, undefined, undefined, undefined, car.body);
      if (hit && (nearest === null || hit.timeOfImpact < nearest)) nearest = hit.timeOfImpact;
    }
    return nearest;
  };
}
