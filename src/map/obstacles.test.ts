import { describe, expect, it } from 'vitest';
import { buildCourse } from '../race/course';
import { suspensionRuns } from '../render/mapMesh';
import { RIVERSIDE_MAP, VALLEY_UP_MAP, WANGAN_MAP } from './maps';
import { buildObstacles } from './obstacles';
import { RAVINE_DEPTH, buildTerrain } from './terrain';
import { parseMap, tileCenter } from './tilemap';

describe('bridges and highways', () => {
  it('parses water and bridges, and bridges are part of the road', () => {
    const map = parseMap(RIVERSIDE_MAP);
    const bridge = map.tileAt(9, 1)!;
    expect(bridge.kind).toBe('road');
    expect(bridge.bridge).toBe(true);
    expect(bridge.connections.sort()).toEqual(['E', 'W']);
    expect(map.tileAt(9, 0)!.kind).toBe('water');
  });

  it('puts parapets on both sides of every bridge tile', () => {
    const map = parseMap(RIVERSIDE_MAP);
    const barriers = buildObstacles(map).boxes.filter((b) => b.kind === 'barrier');
    const bridges = map.tiles.filter((t) => t.bridge).length;
    expect(barriers.length).toBe(bridges * 2);
  });

  it('walls in both sides of the elevated highway and raises buildings from the city below', () => {
    const map = parseMap(WANGAN_MAP);
    const boxes = buildObstacles(map).boxes;
    const roads = map.tiles.filter((t) => t.kind === 'road').length;
    expect(boxes.filter((b) => b.kind === 'barrier').length).toBeGreaterThanOrEqual(roads * 2);
    for (const b of boxes.filter((b) => b.kind === 'building')) expect(b.y - b.hy).toBeCloseTo(-WANGAN_MAP.highway!.depth);
  });
});

describe('mountain passes with bridges and tunnels', () => {
  it('parses tunnels and walls in both sides of tunnels and bridges without guardrails on them', () => {
    const map = parseMap(VALLEY_UP_MAP);
    const tunnels = map.tiles.filter((t) => t.tunnel);
    const bridges = map.tiles.filter((t) => t.bridge);
    expect(tunnels.length).toBe(15);
    expect(bridges.length).toBe(9);
    expect(tunnels.every((t) => t.kind === 'road')).toBe(true);
    const boxes = buildObstacles(map).boxes;
    expect(boxes.filter((b) => b.kind === 'barrier').length).toBe((tunnels.length + bridges.length) * 2);
  });

  it('is a long point-to-point course of about 5km', () => {
    const course = buildCourse(parseMap(VALLEY_UP_MAP));
    expect(course.closed).toBe(false);
    expect(course.length).toBeGreaterThan(4800);
  });

  it('digs a ravine under the bridges while the road stays on the bridge', () => {
    const map = parseMap(VALLEY_UP_MAP);
    const terrain = buildTerrain(map)!;
    const bridge = map.tiles.find((t) => t.bridge && map.tileAt(t.col, t.row - 1)?.kind === 'water')!;
    const { x, z } = tileCenter(map, bridge.col, bridge.row);
    // 橋の真ん中の横（道路の外）は谷の底
    const side = z + map.def.tileSize / 2 - 2;
    expect(terrain.groundAt(x, side)).toBeLessThan(terrain.heightAt(x, z) - RAVINE_DEPTH + 5);
    // 道路の高さは谷に引きずられない
    const before = tileCenter(map, bridge.col - 2, bridge.row);
    const after = tileCenter(map, bridge.col + 2, bridge.row);
    const h = terrain.heightAt(x, z);
    expect(h).toBeGreaterThan(Math.min(terrain.heightAt(before.x, before.z), terrain.heightAt(after.x, after.z)) - 5);
  });
});

describe('highway with a suspension bridge and a loop', () => {
  it('finds the long straight bridge as a suspension bridge', () => {
    const runs = suspensionRuns(parseMap(WANGAN_MAP));
    expect(runs.length).toBe(1);
    expect(runs[0].tiles.length).toBe(11);
    expect(runs[0].alongX).toBe(true);
  });

  it('turns more than 540 degrees one way before turning back', () => {
    const course = buildCourse(parseMap(WANGAN_MAP));
    // 同じ向きに続けて曲がる角度の最大
    let best = 0;
    let run = 0;
    let sign = 0;
    for (let s = 0; s < course.length; s += 2) {
      const k = course.pointAt(s).curvature;
      if (k === 0) continue;
      const turn = Math.sign(k);
      if (turn !== sign) {
        sign = turn;
        run = 0;
      }
      run += Math.abs(k) * 2;
      best = Math.max(best, run);
    }
    expect(best).toBeGreaterThanOrEqual(3 * Math.PI - 0.1);
  });
});
