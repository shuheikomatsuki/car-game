import { describe, expect, it } from 'vitest';
import { HAIRPIN_DOWN_MAP, HAIRPIN_MAP } from './maps';
import { findShortcuts, insideShortcut, shortcutHeight, shortcutPoint } from './shortcuts';
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

  it('descends from the high end to the low end with a step on the way', () => {
    const h = (t: number) => shortcutHeight(t, 10, 2);
    expect(h(0)).toBe(10);
    expect(h(1)).toBeCloseTo(2);
    for (let t = 0; t < 1; t += 0.01) expect(h(t + 0.01)).toBeLessThanOrEqual(h(t) + 1e-9);
    // 段差: ほんの少し進む間に大きく下がる
    expect(h(0.299) - h(0.301)).toBeGreaterThan(2);
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
