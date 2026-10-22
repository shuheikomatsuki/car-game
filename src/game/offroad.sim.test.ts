import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUIT_MAP } from '../map/testMaps';
import { buildObstacles } from '../map/obstacles';
import { parseMap } from '../map/tilemap';
import { buildCourse } from '../race/course';
import { Car } from '../sim/car';
import { type Rapier, createPhysicsWorld, loadRapier } from '../sim/physics';
import { FALL_SECONDS, FallRecovery } from './fall';
import type { Level } from './level';

const DT = 1 / 60;
let rapier: Rapier;

beforeAll(async () => {
  rapier = await loadRapier();
});

/** 何もない平地で、全開で 15 秒走ったときの速度 */
function topSpeed(grass: number): number {
  const physics = createPhysicsWorld(rapier, { boxes: [], trees: [], cones: [], signs: [] });
  const car = new Car(physics, { x: 0, z: 0, yaw: 0 });
  car.offRoad = () => grass;
  for (let i = 0; i < 15 * 60; i++) {
    car.applyInput({ throttle: 1, brake: 0, steer: 0 }, DT);
    physics.world.timestep = DT;
    physics.world.step();
  }
  return car.snapshot().forwardSpeed;
}

describe('off road', () => {
  it('slows the car down on the grass', () => {
    const road = topSpeed(0);
    const grass = topSpeed(1);
    expect(road).toBeGreaterThan(25);
    // 草地では 40km/h くらいまでしか出ない
    expect(grass).toBeLessThan(12);
    expect(grass).toBeGreaterThan(8);
    expect(topSpeed(0.5)).toBeLessThan(road);
  });

  it('puts a fallen car back on the road a little behind', () => {
    const map = parseMap(CIRCUIT_MAP);
    const course = buildCourse(map);
    const physics = createPhysicsWorld(rapier, buildObstacles(map));
    const start = course.gridSpot(-40);
    const car = new Car(physics, start);
    // 道路の外（崖）を判定する部分だけの Level
    const level = {
      fellOff: (x: number, z: number) => Math.abs(course.project(x, z).offset) > 12,
      recoverySpot: (x: number, z: number) => {
        const p = course.pointAt(course.project(x, z).s - 8);
        return { x: p.x, z: p.z, yaw: p.yaw };
      },
    } as unknown as Level;
    const fall = new FallRecovery();
    const left = { x: Math.cos(start.yaw), z: -Math.sin(start.yaw) };
    car.reset({ x: start.x + left.x * 14, z: start.z + left.z * 14, yaw: start.yaw });
    expect(fall.update(DT, level, car, car.snapshot())).toBe('fell');
    expect(fall.falling).toBe(true);
    let result: string | null = null;
    let t = 0;
    while (!result && t < 5) {
      t += DT;
      result = fall.update(DT, level, car, car.snapshot());
      if (!result) expect(fall.drop).toBeGreaterThan(0);
    }
    expect(result).toBe('recovered');
    expect(t).toBeCloseTo(FALL_SECONDS, 1);
    const s = car.snapshot();
    const p = course.project(s.x, s.z);
    expect(Math.abs(p.offset)).toBeLessThan(0.1);
    expect(p.s).toBeCloseTo(40 - 8, 0);
    expect(fall.drop).toBe(0);
  });
});
