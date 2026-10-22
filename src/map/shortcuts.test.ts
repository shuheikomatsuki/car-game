import { describe, expect, it } from 'vitest';
import { HAIRPIN_DOWN_MAP, HAIRPIN_MAP } from './maps';
import { buildCourse } from '../race/course';
import { COUNTDOWN_SECONDS, TimeAttack } from '../race/timeAttack';
import { findShortcuts, insideShortcut, shortcutHeight, shortcutPoint, shortcutStep } from './shortcuts';
import { buildTerrain } from './terrain';
import { parseMap } from './tilemap';

describe('shortcuts', () => {
  it('finds the inside of every hairpin', () => {
    const map = parseMap(HAIRPIN_DOWN_MAP);
    const shortcuts = findShortcuts(map);
    expect(shortcuts.length).toBe(8);
    // 帯は道路の外（草地）に向かって伸び、木とは重ならない
    for (const sc of shortcuts) {
      const p = shortcutPoint(sc, 0, sc.wMax);
      const tile = map.tileAt(Math.round(p.x / map.def.tileSize), Math.round(p.z / map.def.tileSize));
      expect(tile?.kind).toBe('grass');
    }
  });

  it('only builds them on maps that ask for them', () => {
    expect(buildTerrain(parseMap(HAIRPIN_MAP))!.shortcuts).toEqual([]);
  });

  it('descends from the upper road and ends a step above the lower road', () => {
    const h = (t: number) => shortcutHeight(t, 10, 2);
    expect(h(0)).toBe(10);
    expect(h(1)).toBeCloseTo(2 + shortcutStep(8));
    expect(shortcutStep(8)).toBeGreaterThan(2);
    for (let t = 0; t < 1; t += 0.01) expect(h(t + 0.01)).toBeLessThanOrEqual(h(t) + 1e-9);
  });

  it('drops straight onto the lower road at the end', () => {
    const map = parseMap(HAIRPIN_DOWN_MAP);
    const terrain = buildTerrain(map)!;
    const rw = map.def.roadWidth / 2;
    for (const sc of terrain.shortcuts) {
      // 下の道路の内側の縁をはさんで、面の側と道路の側の高さを比べる
      const w = rw + 0.6 * map.def.tileSize;
      const a = shortcutPoint(sc, sc.uEdge - 0.5, w);
      const b = shortcutPoint(sc, sc.uEdge + 0.5, w);
      const c = shortcutPoint(sc, -sc.uEdge + 0.5, w);
      const d = shortcutPoint(sc, -sc.uEdge - 0.5, w);
      const [hiSide, loSide] = terrain.heightAt(a.x, a.z) > terrain.heightAt(b.x, b.z) ? [[a, b], [c, d]] : [[c, d], [a, b]];
      expect(terrain.heightAt(hiSide[0].x, hiSide[0].z) - terrain.heightAt(hiSide[1].x, hiSide[1].z)).toBeGreaterThan(2);
      // 上の道路からは段差なく入れる
      expect(Math.abs(terrain.heightAt(loSide[0].x, loSide[0].z) - terrain.heightAt(loSide[1].x, loSide[1].z))).toBeLessThan(0.5);
    }
  });

  it('does not count cutting through a shortcut as leaving the course', () => {
    const map = parseMap(HAIRPIN_DOWN_MAP);
    const course = buildCourse(map);
    const race = new TimeAttack(course, 1);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const size = map.def.tileSize;
    const skipped = new Set<number>();
    for (const sc of findShortcuts(map)) {
      const m = course.indexAt(sc.x, sc.z);
      for (const k of [m - 1, m, m + 1]) skipped.add(k);
    }
    expect(skipped.size).toBe(24);
    course.tiles.forEach((t, i) => {
      if (!skipped.has(i)) race.update(0.05, { x: t.col * size, z: t.row * size, vx: 0, vz: 0 });
    });
    const events = race.drainEvents();
    expect(events.some((e) => e.type === 'offCourse' && e.on)).toBe(false);
    expect(race.phase).toBe('finished');
  });

  it('keeps the ground of the strip above the cliff', () => {
    const map = parseMap(HAIRPIN_DOWN_MAP);
    const terrain = buildTerrain(map)!;
    for (const sc of terrain.shortcuts) {
      const inside = shortcutPoint(sc, 0, sc.wMax - 1);
      const outside = shortcutPoint(sc, 0, sc.wMax + 8);
      expect(insideShortcut(sc, inside.x, inside.z)).toBe(true);
      // 帯の外は崖の下
      expect(terrain.heightAt(inside.x, inside.z) - terrain.heightAt(outside.x, outside.z)).toBeGreaterThan(3);
    }
  });
});
