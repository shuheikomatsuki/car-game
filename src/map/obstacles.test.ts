import { describe, expect, it } from 'vitest';
import { RIVERSIDE_MAP, WANGAN_MAP } from './maps';
import { buildObstacles } from './obstacles';
import { parseMap } from './tilemap';

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
