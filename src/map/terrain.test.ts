import { describe, expect, it } from 'vitest';
import { buildCourse } from '../race/course';
import { Car } from '../sim/car';
import { createPhysicsWorld, loadRapier } from '../sim/physics';
import { HILLCLIMB_MAP, CIRCUIT_MAP } from './maps';
import { buildObstacles } from './obstacles';
import { buildTerrain, elevationProfile } from './terrain';
import { parseMap } from './tilemap';

describe('terrain', () => {
  const map = parseMap(HILLCLIMB_MAP);
  const terrain = buildTerrain(map)!;
  const course = buildCourse(map);

  it('is flat (no terrain) on maps without elevation', () => {
    expect(buildTerrain(parseMap(CIRCUIT_MAP))).toBeNull();
  });

  it('always climbs along the profile', () => {
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const h = elevationProfile(t, 100);
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
    expect(elevationProfile(1, 100)).toBeCloseTo(100);
  });

  it('rises along the hill climb from the start to the finish', () => {
    const start = terrain.heightAt(course.line.x, course.line.z);
    const finish = terrain.heightAt(course.finishLine.x, course.finishLine.z);
    expect(finish - start).toBeGreaterThan(120);
    // 道路に沿って、段差なくなめらかに上る
    let prev = terrain.heightAt(course.pointAt(0).x, course.pointAt(0).z);
    for (let s = 2; s <= course.length; s += 2) {
      const p = course.pointAt(s);
      const h = terrain.heightAt(p.x, p.z);
      expect(h - prev).toBeGreaterThan(-0.05);
      expect(h - prev).toBeLessThan(2 * 0.2);
      prev = h;
    }
  });

  it('is level across the road', () => {
    for (let s = 10; s < course.length; s += 97) {
      const p = course.pointAt(s);
      const lx = Math.cos(p.yaw);
      const lz = -Math.sin(p.yaw);
      const w = HILLCLIMB_MAP.roadWidth / 2 - 1;
      const diff = terrain.heightAt(p.x + lx * w, p.z + lz * w) - terrain.heightAt(p.x - lx * w, p.z - lz * w);
      expect(Math.abs(diff)).toBeLessThan(0.6);
    }
  });

  it('slows a car rolling up the hill and speeds it up going down', async () => {
    const rapier = await loadRapier();
    const run = (yawOffset: number) => {
      const physics = createPhysicsWorld(rapier, buildObstacles(map));
      // 最初の直線の途中で、上り（0）または下り（π）向きに置く
      const p = course.pointAt(course.length * 0 + 60);
      const car = new Car(physics, { x: p.x, z: p.z, yaw: p.yaw + yawOffset });
      car.slope = (x, z) => terrain.gradientAt(x, z);
      const fx = Math.sin(p.yaw + yawOffset);
      const fz = Math.cos(p.yaw + yawOffset);
      car.body.setLinvel({ x: fx * 15, y: 0, z: fz * 15 }, true);
      for (let i = 0; i < 60; i++) {
        car.applyInput({ throttle: 0, brake: 0, steer: 0 }, 1 / 60);
        physics.world.step();
      }
      return car.snapshot().forwardSpeed;
    };
    const flat = 15 - 0.8 - 0.0015 * 225;
    const up = run(0);
    const down = run(Math.PI);
    expect(up).toBeLessThan(flat - 0.2);
    expect(down).toBeGreaterThan(flat + 0.2);
  });
});
