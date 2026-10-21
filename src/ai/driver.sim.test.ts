import { beforeAll, describe, expect, it } from 'vitest';
import { SCHOOL_MAP, TOWN_MAP } from '../map/maps';
import { buildObstacles } from '../map/obstacles';
import { DIR_YAW, type MapDefinition, parseMap, tileCenter } from '../map/tilemap';
import { Car } from '../sim/car';
import { type Rapier, createPhysicsWorld, loadRapier } from '../sim/physics';
import { createObstacleSensor } from '../sim/sensors';
import type { Command } from './commands';
import { CharacterDriver, type DriverEvent } from './driver';
import { PERSONALITIES, type Personality, createRng } from './personality';

/**
 * 実際の物理ワールドの上でキャラクターに運転させる結合テスト。
 */

const DT = 1 / 60;
const EASY = PERSONALITIES.find((p) => p.id === 'easy')!;
let rapier: Rapier;

beforeAll(async () => {
  rapier = await loadRapier();
});

function createSim(def: MapDefinition, personality: Personality = EASY, seed = 1) {
  const map = parseMap(def);
  const physics = createPhysicsWorld(rapier, buildObstacles(map));
  const spawn = { ...tileCenter(map, def.start.col, def.start.row), yaw: DIR_YAW[def.start.heading] };
  // 左車線から出発
  spawn.z -= 3;
  const car = new Car(physics, spawn);
  const driver = new CharacterDriver(map, personality, createRng(seed));
  const sense = createObstacleSensor(physics, car);
  const events: DriverEvent[] = [];
  let distance = 0;
  let maxImpact = 0;
  let lastInput = { throttle: 0, brake: 0, steer: 0 };
  let offRoadSteps = 0;

  const run = (seconds: number, onEvent?: (e: DriverEvent) => void) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const snap = car.snapshot();
      lastInput = driver.update(DT, snap, sense);
      car.applyInput(lastInput, DT);
      physics.world.timestep = DT;
      physics.world.step();
      const impact = car.measureImpact();
      maxImpact = Math.max(maxImpact, impact);
      if (impact > 2.5) driver.notifyCollision();
      const after = car.snapshot();
      distance += Math.abs(after.forwardSpeed) * DT;
      // 車の中心が道路の上にあるか（カーブの外側の草地にはみ出していないか）
      const roadHalf = def.roadWidth / 2;
      const tile = map.tileAt(Math.round(after.x / def.tileSize), Math.round(after.z / def.tileSize));
      const lx = Math.abs(after.x - Math.round(after.x / def.tileSize) * def.tileSize);
      const lz = Math.abs(after.z - Math.round(after.z / def.tileSize) * def.tileSize);
      const onSquare = tile?.kind === 'road' && (lx < roadHalf || lz < roadHalf);
      if (!onSquare) offRoadSteps++;
      for (const e of driver.drainEvents()) {
        events.push(e);
        onEvent?.(e);
      }
    }
  };
  const say = (c: Command) => driver.command(c);
  return {
    car,
    driver,
    events,
    run,
    say,
    get distance() {
      return distance;
    },
    get maxImpact() {
      return maxImpact;
    },
    get lastInput() {
      return lastInput;
    },
    get offRoadSteps() {
      return offRoadSteps;
    },
  };
}

/** コーンを取り除いたコース（周回テスト用） */
const SCHOOL_NO_CONES: MapDefinition = {
  ...SCHOOL_MAP,
  layout: SCHOOL_MAP.layout.map((row) => row.replace(/c/g, 'R')),
};

describe('CharacterDriver on the physics world', () => {
  it('waits until told to start', () => {
    const sim = createSim(SCHOOL_NO_CONES);
    sim.run(3);
    expect(sim.distance).toBeLessThan(0.1);
    expect(sim.driver.state).toBe('parked');
  });

  it('laps the driving school course without hitting anything, asking for directions at T-junctions', () => {
    const sim = createSim(SCHOOL_NO_CONES);
    sim.say('start');
    let asks = 0;
    sim.run(150, (e) => {
      if (e.type === 'askDirection') {
        asks++;
        sim.say(asks % 2 ? 'turnLeft' : 'turnRight');
      }
    });
    expect(asks).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.type === 'turning')).toBe(true);
    expect(sim.events.filter((e) => e.type === 'collision')).toEqual([]);
    expect(sim.maxImpact).toBeLessThan(2.5);
    expect(sim.distance).toBeGreaterThan(500);
    expect(sim.events.some((e) => e.type === 'lost')).toBe(false);
    expect(sim.offRoadSteps).toBe(0);
  });

  it.each(['normal', 'hard'])('drives safely with the clumsy "%s" personality', (id) => {
    const personality = PERSONALITIES.find((p) => p.id === id)!;
    for (const seed of [1, 2, 3]) {
      const sim = createSim(SCHOOL_NO_CONES, personality, seed);
      sim.say('start');
      sim.run(120, (e) => {
        if (e.type === 'askDirection') sim.say('turnRight');
        // 急ブレーキや衝突で止まったら、また発進させる
        if (e.type === 'stopped') sim.say('start');
      });
      expect(sim.maxImpact, `seed ${seed}`).toBeLessThan(2.5);
      expect(sim.offRoadSteps, `seed ${seed}`).toBe(0);
      expect(sim.distance, `seed ${seed}`).toBeGreaterThan(300);
    }
  });

  it('stops for cones in the lane and pushes through slowly when told to start again', () => {
    const sim = createSim(TOWN_MAP);
    sim.say('start');
    sim.run(25);
    expect(sim.events.some((e) => e.type === 'obstacle')).toBe(true);
    expect(Math.abs(sim.car.snapshot().forwardSpeed)).toBeLessThan(0.5);
    const xBefore = sim.car.snapshot().x;
    sim.say('start');
    sim.run(4);
    expect(sim.car.snapshot().x).toBeGreaterThan(xBefore + 1);
  });

  it('stops quickly on "danger" even with a clumsy personality', () => {
    const hard = PERSONALITIES.find((p) => p.id === 'hard')!;
    const sim = createSim(SCHOOL_NO_CONES, { ...hard, suddenBrakePerMinute: 0 });
    sim.say('start');
    sim.say('faster');
    sim.run(6);
    const speed = sim.car.snapshot().forwardSpeed;
    expect(speed).toBeGreaterThan(5);
    sim.say('danger');
    sim.run(hard.emergencyDelay[1] + 0.05);
    expect(sim.lastInput.brake).toBe(1);
    sim.run(2);
    expect(sim.driver.state).toBe('parked');
    expect(sim.events.some((e) => e.type === 'stopped')).toBe(true);
  });

  it('can mishear left and right, and says what it heard', () => {
    const sim = createSim(SCHOOL_NO_CONES, { ...EASY, mishearChance: 1 });
    sim.say('turnLeft');
    sim.run(1);
    expect(sim.events).toContainEqual({ type: 'ack', command: 'turnRight', misheard: true });
    expect(sim.driver.pendingTurn).toBe('right');
  });
});
