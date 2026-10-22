import { beforeAll, describe, expect, it } from 'vitest';
import { SCHOOL_MAP, TOWN_MAP } from '../map/maps';
import { buildObstacles } from '../map/obstacles';
import { DIR_YAW, type MapDefinition, parseMap, tileCenter } from '../map/tilemap';
import { Car } from '../sim/car';
import { VEHICLE_PRESETS, type VehicleParams } from '../sim/vehicle';
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

function createSim(def: MapDefinition, personality: Personality = EASY, seed = 1, params?: VehicleParams) {
  const map = parseMap(def);
  const physics = createPhysicsWorld(rapier, buildObstacles(map));
  const spawn = { ...tileCenter(map, def.start.col, def.start.row), yaw: DIR_YAW[def.start.heading] };
  // 左車線から出発
  spawn.z -= 3;
  const car = new Car(physics, spawn, params);
  const driver = new CharacterDriver(map, personality, createRng(seed), params);
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

const TOWN_MAP_NO_CONES: MapDefinition = {
  ...TOWN_MAP,
  layout: TOWN_MAP.layout.map((row) => row.replace(/c/g, 'R')),
};

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

  it('laps the driving school course without hitting anything, choosing a way at T-junctions by itself or as told', () => {
    const sim = createSim(SCHOOL_NO_CONES);
    sim.say('start');
    let autoTurns = 0;
    sim.run(150, (e) => {
      if (e.type === 'autoTurn') {
        autoTurns++;
        // 自分で決めた方向を、ときどき反対に言い直す
        if (autoTurns % 2 === 0) sim.say(e.turn === 'left' ? 'turnRight' : 'turnLeft');
      }
    });
    expect(autoTurns).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.type === 'stopped')).toBe(false);
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
        if (e.type === 'autoTurn') sim.say('turnRight');
        // 急ブレーキや衝突で止まったら、また発進させる
        if (e.type === 'stopped') sim.say('start');
      });
      expect(sim.maxImpact, `seed ${seed}`).toBeLessThan(2.5);
      expect(sim.offRoadSteps, `seed ${seed}`).toBe(0);
      expect(sim.distance, `seed ${seed}`).toBeGreaterThan(300);
    }
  });

  it('drives at top speed in the sports car without leaving the road', () => {
    const sport = VEHICLE_PRESETS.find((v) => v.id === 'sport')!.params;
    const sim = createSim(SCHOOL_NO_CONES, EASY, 1, sport);
    sim.say('start');
    for (let i = 0; i < 4; i++) sim.say('faster');
    let top = 0;
    for (let t = 0; t < 120; t++) {
      sim.run(1, (e) => {
        if (e.type === 'autoTurn' && t % 3 === 0) sim.say('turnRight');
      });
      top = Math.max(top, sim.car.snapshot().forwardSpeed * 3.6);
    }
    expect(sim.driver.speedKmh).toBe(100);
    // 直線では実際に普通の巡航（40km/h）より速く走る
    expect(top).toBeGreaterThan(60);
    expect(sim.maxImpact).toBeLessThan(2.5);
    expect(sim.offRoadSteps).toBe(0);
    expect(sim.distance).toBeGreaterThan(700);
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

  it('turns at the junction just ahead when told in time, even after deciding to go straight', () => {
    // (2,4) から東へ。(5,4) の交差点（入口 x=90）の 20m ほど手前で「右」と言う
    const sim2 = createSim(TOWN_MAP_NO_CONES);
    sim2.say('start');
    let told = false;
    let turned = false;
    for (let i = 0; i < 60 * 30 && !turned; i++) {
      sim2.run(DT);
      if (!told && sim2.car.snapshot().x > 70) {
        sim2.say('turnRight');
        told = true;
      }
      if (sim2.events.some((e) => e.type === 'turning' && e.turn === 'right')) turned = true;
    }
    expect(turned).toBe(true);
    // 右（南）へ曲がって (5,5) 側へ進む
    sim2.run(5);
    expect(sim2.car.snapshot().z).toBeGreaterThan(92);
    expect(sim2.maxImpact).toBeLessThan(2.5);
    expect(sim2.offRoadSteps).toBe(0);
  });

  it('makes a U-turn when told and drives back the other way', () => {
    const sim = createSim(TOWN_MAP_NO_CONES);
    sim.say('start');
    sim.run(4);
    sim.say('uturn');
    // 速度を落とせる距離の先のタイルでUターンする
    let uturnX = 0;
    sim.run(17, (e) => {
      if (e.type === 'uturning') uturnX = sim.car.snapshot().x;
    });
    expect(uturnX).toBeGreaterThan(0);
    const s = sim.car.snapshot();
    // 西向き（yaw ≈ -90°）で、Uターンを始めた地点より西へ戻っている
    expect(Math.sin(s.yaw)).toBeLessThan(-0.8);
    expect(s.x).toBeLessThan(uturnX - 10);
    expect(sim.maxImpact).toBeLessThan(2.5);
    expect(sim.offRoadSteps).toBe(0);
  });

  it('never turns on its own at a junction where it can go straight with the "normal" personality', () => {
    const normal = PERSONALITIES.find((p) => p.id === 'normal')!;
    for (const seed of [1, 2, 3, 4]) {
      const sim = createSim(SCHOOL_NO_CONES, normal, seed);
      sim.say('start');
      sim.run(60);
      expect(sim.events.some((e) => e.type === 'wrongTurn' || e.type === 'suddenBrake'), `seed ${seed}`).toBe(false);
    }
  });

  it('can mishear left and right, and says what it heard', () => {
    const sim = createSim(SCHOOL_NO_CONES, { ...EASY, mishearChance: 1 });
    sim.say('turnLeft');
    sim.run(1);
    expect(sim.events).toContainEqual({ type: 'ack', command: 'turnRight', misheard: true });
    expect(sim.driver.pendingTurn).toBe('right');
  });
});
