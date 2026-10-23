import { beforeAll, describe, expect, it } from 'vitest';
import { Track } from '../game/track';
import { CIRCUIT_MAP, HAIRPIN_MAP, MAPS, STEEP_DOWN_MAP, TECHNICAL_MAP } from '../map/maps';
import { TECHNICAL_MAP as TILE_TECHNICAL_MAP } from '../map/testMaps';
import { type MapDefinition, parseMap } from '../map/tilemap';
import { type Rapier, loadRapier } from '../sim/physics';
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
  // 坂・草地・立体交差の扱いはゲームと同じ（Track）
  const track = new Track(rapier, def);
  const course = track.course!;
  const physics = track.physics;
  const line = buildRacingLine(course);
  const gradient = track.hasSlopes ? (x: number, z: number, s: number) => track.slopeAt(x, z, s) : undefined;
  const side = Math.min(2.5, course.widthAt(0) / 4);
  const racers = levels.map((level, i) => {
    const car = track.createCar(course.gridSpot(6 + 8 * i, i % 2 === 0 ? side : -side));
    car.params = { ...params };
    return { car, driver: new NpcDriver(line, params, level, 1, gradient), timer: new TimeAttack(course, laps), maxOffset: 0, maxImpact: 0 };
  });
  // 平均 8m/s でも走りきれる時間（最低 6 分）
  const limit = 60 * Math.max(360, course.length / 8);
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
      // 道路の端からはみ出した距離（U ターンの広場の中は道路の上）
      if (r.timer.phase === 'racing') r.maxOffset = Math.max(r.maxOffset, track.offRoadDistance(s.x, s.z, s.courseS)!);
    });
    if (racers.every((r) => r.timer.phase === 'finished')) break;
  }
  return { course, line, racers };
}

describe('racing line', () => {
  it('stays on the road and is faster than the centerline', () => {
    const course = buildCourse(parseMap(TILE_TECHNICAL_MAP));
    const line = buildRacingLine(course);
    const limit = TILE_TECHNICAL_MAP.roadWidth / 2;
    for (let i = 0; i < line.count; i++) expect(Math.abs(line.offset[i])).toBeLessThan(limit);
    const center = buildRacingLine(course, TILE_TECHNICAL_MAP.roadWidth / 2);
    const opts = { grip: 1, brake: 1 };
    const fast = profileTime(line, buildSpeedProfile(line, DEFAULT_VEHICLE_PARAMS, opts));
    const slow = profileTime(center, buildSpeedProfile(center, DEFAULT_VEHICLE_PARAMS, opts));
    expect(fast).toBeLessThan(slow * 0.95);
  });
});

describe('NPC race', () => {
  it.each(MAPS.filter((m) => m.race).map((m) => [m.name, m] as const))(
    'every level finishes %s without leaving the road',
    (_, def) => {
      const { racers } = race(def, [...NPC_LEVELS]);
      const times = racers.map((r) => r.timer.laps[0]);
      console.log(def.name, NPC_LEVELS.map((l, i) => `${l.label} ${times[i]?.toFixed(2)} off ${racers[i].maxOffset.toFixed(1)} hit ${racers[i].maxImpact.toFixed(1)}`).join(' / '));
      for (const r of racers) {
        expect(r.timer.phase).toBe('finished');
        // 押し合って路肩の草地へはみ出すことはあっても、崖から落ちるほどは外れない
        expect(r.maxOffset).toBeLessThan(3);
      }
    },
    60000,
  );

  it('ranks the levels: stronger NPCs are faster when driving alone', () => {
    const times = NPC_LEVELS.map((level) => race(TECHNICAL_MAP, [level]).racers[0].timer.laps[0]);
    console.log('alone', times.map((t) => t.toFixed(2)).join(' '));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]);
  }, 60000);

  it('drives the RX-7 on the circuit', () => {
    const sport = VEHICLE_PRESETS.find((v) => v.id === 'fd3s')!.params;
    const { racers } = race(CIRCUIT_MAP, [NPC_LEVELS[3]], sport);
    console.log('fd3s pro', racers[0].timer.laps[0].toFixed(2), 'off', racers[0].maxOffset.toFixed(1));
    expect(racers[0].timer.phase).toBe('finished');
  }, 60000);

  it.each(VEHICLE_PRESETS.map((v) => [v.label, v] as const))('drives %s down the hairpins and the steep pass', (_, v) => {
    for (const def of [HAIRPIN_MAP, STEEP_DOWN_MAP]) {
      const { racers } = race(def, [NPC_LEVELS[3]], v.params);
      console.log(v.label, def.name, racers[0].timer.laps[0]?.toFixed(2), 'off', racers[0].maxOffset.toFixed(1));
      expect(racers[0].timer.phase).toBe('finished');
      expect(racers[0].maxOffset).toBeLessThan(3);
    }
  }, 60000);
});
