import { describe, expect, it } from 'vitest';
import { CIRCUIT_MAP, SCHOOL_MAP } from '../map/maps';
import { parseMap } from '../map/tilemap';
import { buildCourse } from './course';
import { GhostRecorder, ghostPoseAt } from './ghost';
import { mergeRecord, parseRecord } from './records';
import { COUNTDOWN_SECONDS, TimeAttack, formatTime } from './timeAttack';

const course = buildCourse(parseMap(CIRCUIT_MAP));
const size = CIRCUIT_MAP.tileSize;

describe('buildCourse', () => {
  it('traces the whole circuit as one loop', () => {
    const roads = course.map.tiles.filter((t) => t.kind === 'road').length;
    expect(course.tiles.length).toBe(roads);
    expect(course.tiles[0]).toMatchObject({ col: 6, row: 1, exit: 'E' });
    // 一周の終わりはスタートの1つ手前（西隣）
    const last = course.tiles[course.tiles.length - 1];
    expect([last.col, last.row]).toEqual([5, 1]);
  });

  it('puts the start line at the entry of the start tile', () => {
    expect(course.line.x).toBeCloseTo(6 * size - size / 2);
    expect(course.line.z).toBeCloseTo(size);
    const spot = course.gridSpot(8, 3);
    expect(spot.x).toBeCloseTo(course.line.x - 8);
    // 東向きの左は北（-Z）
    expect(spot.z).toBeCloseTo(course.line.z - 3);
  });

  it('rejects maps with junctions', () => {
    expect(() => buildCourse(parseMap(SCHOOL_MAP))).toThrow();
  });

  it('gives the travel direction on curves', () => {
    const corner = course.tiles.findIndex((t) => t.col === 13 && t.row === 1);
    const d = course.directionAt(corner);
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.z).toBeCloseTo(Math.SQRT1_2);
  });
});

/** 各タイルの中心を順にたどる（1タイルあたり steps ステップ） */
function driveLaps(race: TimeAttack, laps: number, steps = 30, dt = 0.05) {
  const tiles = course.tiles;
  // スタート位置（1つ手前のタイル）から始める
  const order = [tiles[tiles.length - 1], ...Array.from({ length: tiles.length * laps + 1 }, (_, i) => tiles[i % tiles.length])];
  for (const t of order) {
    for (let i = 0; i < steps; i++) race.update(dt, { x: t.col * size, z: t.row * size, vx: 0, vz: 0 });
  }
}

describe('TimeAttack', () => {
  it('counts down before the start', () => {
    const race = new TimeAttack(course, 3);
    const counts: number[] = [];
    for (const e of race.drainEvents()) if (e.type === 'count') counts.push(e.value);
    for (let i = 0; i < 70; i++) {
      race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
      for (const e of race.drainEvents()) if (e.type === 'count') counts.push(e.value);
    }
    expect(counts).toEqual([3, 2, 1, 0]);
    expect(race.phase).toBe('racing');
    expect(race.canDrive).toBe(true);
    expect(race.time).toBeGreaterThan(0);
  });

  it('counts laps when following the course and finishes', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    race.drainEvents();
    driveLaps(race, 3);
    const events = race.drainEvents();
    expect(events.filter((e) => e.type === 'lap').length).toBe(3);
    const finish = events.find((e) => e.type === 'finish');
    expect(finish).toBeDefined();
    expect(race.phase).toBe('finished');
    expect(race.laps.length).toBe(3);
    // 1周 = タイル数 × 30 ステップ × 0.05 秒
    expect(race.laps[1]).toBeCloseTo(course.tiles.length * 30 * 0.05, 5);
  });

  it('does not count a lap when cutting across the infield', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const tiles = course.tiles;
    const at = (t: { col: number; row: number }) => ({ x: t.col * size, z: t.row * size, vx: 0, vz: 0 });
    race.update(0.05, at(tiles[tiles.length - 1]));
    race.update(0.05, at(tiles[0]));
    race.update(0.05, at(tiles[1]));
    // 途中を飛ばして先へ進み、そのまま一周の残りを走る
    const jump = Math.floor(tiles.length / 3);
    for (let i = jump; i <= tiles.length; i++) race.update(0.05, at(tiles[i % tiles.length]));
    const events = race.drainEvents();
    expect(events.some((e) => e.type === 'offCourse' && e.on)).toBe(true);
    expect(events.some((e) => e.type === 'lap')).toBe(false);
  });

  it('warns when driving the wrong way', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const start = course.tiles[0];
    // スタートの直線は東向き。西へ走る
    for (let i = 0; i < 30; i++) race.update(0.05, { x: start.col * size, z: start.row * size, vx: -10, vz: 0 });
    expect(race.isWrongWay).toBe(true);
    for (let i = 0; i < 2; i++) race.update(0.05, { x: start.col * size, z: start.row * size, vx: 10, vz: 0 });
    expect(race.isWrongWay).toBe(false);
  });
});

describe('ghost', () => {
  it('records poses at a fixed interval and interpolates between them', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i <= 20; i++) rec.sample(i * 0.05, { x: i, z: 0, yaw: 0 });
    // 0.0, 0.1, ..., 1.0 の 11 個
    expect(rec.frames.length).toBe(33);
    const p = ghostPoseAt(rec.frames, 0.25)!;
    expect(p.x).toBeCloseTo(5);
    expect(ghostPoseAt(rec.frames, 5)).toBeNull();
  });

  it('interpolates yaw across the ±π boundary', () => {
    const data = [0, 0, Math.PI - 0.1, 0, 0, -Math.PI + 0.1];
    const p = ghostPoseAt(data, 0.05)!;
    expect(Math.abs(Math.abs(p.yaw) - Math.PI)).toBeLessThan(0.01);
  });
});

describe('records', () => {
  it('keeps the faster total and the fastest lap', () => {
    const first = mergeRecord(null, { total: 90, laps: [32, 29, 29], ghost: [1, 2, 3] });
    expect(first.newTotal).toBe(true);
    expect(first.record.bestLap).toBe(29);
    const slower = mergeRecord(first.record, { total: 95, laps: [40, 27, 28], ghost: [4, 5, 6] });
    expect(slower.newTotal).toBe(false);
    expect(slower.newLap).toBe(true);
    expect(slower.record.total).toBe(90);
    expect(slower.record.ghost).toEqual([1, 2, 3]);
    expect(slower.record.bestLap).toBe(27);
  });

  it('ignores broken saved data', () => {
    expect(parseRecord('nope')).toBeNull();
    expect(parseRecord('{"total":"x"}')).toBeNull();
    expect(parseRecord('{"total":90,"laps":[30,30,30],"ghost":[1,2]}')?.ghost).toEqual([]);
  });

  it('formats times', () => {
    expect(formatTime(83.456)).toBe('1:23.46');
    expect(formatTime(5.1)).toBe('0:05.10');
  });
});
