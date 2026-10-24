import { Track } from '../game/track';
import { type MapDefinition } from '../map/tilemap';
import { type Rapier, loadRapier } from '../sim/physics';
import { DEFAULT_VEHICLE_PARAMS, type VehicleParams } from '../sim/vehicle';
import { type NpcLevel, NpcDriver } from './npcDriver';
import { buildRacingLine } from './racingLine';
import { TimeAttack } from './timeAttack';

/**
 * 実際の物理ワールドの上で NPC にレースを走らせる（結合テスト用）。
 * テストはファイルごとに並列で走るので、重いテストは何ファイルかに分けてここを使う
 */

const DT = 1 / 60;
let rapier: Rapier | null = null;

export async function initNpcSim(): Promise<void> {
  rapier ??= await loadRapier();
}

export function simulateNpcRace(def: MapDefinition, levels: NpcLevel[], params: VehicleParams = DEFAULT_VEHICLE_PARAMS, laps = 1) {
  if (!rapier) throw new Error('initNpcSim() を先に呼ぶ');
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

