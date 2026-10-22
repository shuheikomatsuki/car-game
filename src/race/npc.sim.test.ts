import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUIT_MAP, DOWNHILL_MAP, HILLCLIMB_MAP, TECHNICAL_MAP } from '../map/maps';
import { buildObstacles } from '../map/obstacles';
import { buildTerrain } from '../map/terrain';
import { type MapDefinition, parseMap } from '../map/tilemap';
import { Car } from '../sim/car';
import { type Rapier, createPhysicsWorld, loadRapier } from '../sim/physics';
import { DEFAULT_VEHICLE_PARAMS, VEHICLE_PRESETS, type VehicleParams } from '../sim/vehicle';
import { buildCourse } from './course';
import { NPC_LEVELS, type NpcLevel, NpcDriver } from './npcDriver';
import { buildRacingLine, buildSpeedProfile, profileTime } from './racingLine';
import { TimeAttack } from './timeAttack';

/**
 * 実際の物理ワールドの上で NPC にレースを走らせる結合テスト。
 */

const DT = 1 / 60;
let rapier: Rapier;

beforeAll(async () => {
  rapier = await loadRapier();
});

function race(def: MapDefinition, levels: NpcLevel[], params: VehicleParams = DEFAULT_VEHICLE_PARAMS, laps = 1) {
  const map = parseMap(def);
  const course = buildCourse(map);
  const terrain = buildTerrain(map);
  const physics = createPhysicsWorld(rapier, buildObstacles(map));
  const line = buildRacingLine(course);
  const gradient = terrain ? (x: number, z: number) => terrain.gradientAt(x, z) : undefined;
  const racers = levels.map((level, i) => {
    const car = new Car(physics, course.gridSpot(6 + 8 * i, i % 2 === 0 ? 2.5 : -2.5), params);
    if (gradient) car.slope = gradient;
    return { car, driver: new NpcDriver(line, params, level, 1, gradient), timer: new TimeAttack(course, laps), maxOffset: 0, maxImpact: 0 };
  });
  const limit = 60 * 60 * 6;
  for (let step = 0; step < limit; step++) {
    const snaps = racers.map((r) => r.car.snapshot());
    racers.forEach((r, i) => {
      const s = snaps[i];
      const input = r.timer.canDrive
        ? r.driver.update(
            DT,
            s,
            snaps.filter((_, j) => j !== i).map((o) => ({ x: o.x, z: o.z, vx: Math.sin(o.yaw) * o.forwardSpeed, vz: Math.cos(o.yaw) * o.forwardSpeed })),
          )
        : { throttle: 0, brake: 0, steer: 0 };
      r.car.applyInput(input, DT);
    });
    physics.world.timestep = DT;
    physics.world.step();
    racers.forEach((r) => {
      r.maxImpact = Math.max(r.maxImpact, r.car.measureImpact());
      const s = r.car.snapshot();
      const vx = Math.sin(s.yaw) * s.forwardSpeed;
      const vz = Math.cos(s.yaw) * s.forwardSpeed;
      r.timer.update(DT, { x: s.x, z: s.z, vx, vz });
      if (r.timer.phase === 'racing') r.maxOffset = Math.max(r.maxOffset, Math.abs(course.project(s.x, s.z).offset));
    });
    if (racers.every((r) => r.timer.phase === 'finished')) break;
  }
  return { course, line, racers };
}

describe('racing line', () => {
  it('stays on the road and is faster than the centerline', () => {
    const course = buildCourse(parseMap(TECHNICAL_MAP));
    const line = buildRacingLine(course);
    const limit = TECHNICAL_MAP.roadWidth / 2;
    for (let i = 0; i < line.count; i++) expect(Math.abs(line.offset[i])).toBeLessThan(limit);
    const center = buildRacingLine(course, TECHNICAL_MAP.roadWidth / 2);
    const opts = { grip: 1, brake: 1 };
    const fast = profileTime(line, buildSpeedProfile(line, DEFAULT_VEHICLE_PARAMS, opts));
    const slow = profileTime(center, buildSpeedProfile(center, DEFAULT_VEHICLE_PARAMS, opts));
    expect(fast).toBeLessThan(slow * 0.95);
  });
});

describe('NPC race', () => {
  it.each([CIRCUIT_MAP, TECHNICAL_MAP, HILLCLIMB_MAP, DOWNHILL_MAP].map((m) => [m.name, m] as const))(
    'every level finishes %s without leaving the road',
    (_, def) => {
      const { racers } = race(def, [...NPC_LEVELS]);
      const times = racers.map((r) => r.timer.laps[0]);
      console.log(def.name, NPC_LEVELS.map((l, i) => `${l.label} ${times[i]?.toFixed(2)} off ${racers[i].maxOffset.toFixed(1)} hit ${racers[i].maxImpact.toFixed(1)}`).join(' / '));
      for (const r of racers) {
        expect(r.timer.phase).toBe('finished');
        expect(r.maxOffset).toBeLessThan(def.roadWidth / 2 + 2);
      }
    },
    60000,
  );

  it('ranks the levels: stronger NPCs are faster when driving alone', () => {
    const times = NPC_LEVELS.map((level) => race(TECHNICAL_MAP, [level]).racers[0].timer.laps[0]);
    console.log('alone', times.map((t) => t.toFixed(2)).join(' '));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]);
  }, 60000);

  it('drives the sports car on the circuit', () => {
    const sport = VEHICLE_PRESETS.find((v) => v.id === 'sport')!.params;
    const { racers } = race(CIRCUIT_MAP, [NPC_LEVELS[3]], sport);
    console.log('sport pro', racers[0].timer.laps[0].toFixed(2), 'off', racers[0].maxOffset.toFixed(1));
    expect(racers[0].timer.phase).toBe('finished');
  }, 60000);
});
