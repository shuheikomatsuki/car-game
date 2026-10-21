import { describe, expect, it } from 'vitest';
import { TOWN_MAP } from './maps';
import { buildObstacles } from './obstacles';
import { type MapDefinition, parseMap, roadShape } from './tilemap';

const tiny = (layout: string[]): MapDefinition => ({
  name: 'test',
  tileSize: 20,
  roadWidth: 12,
  layout,
  start: { col: 1, row: 1, heading: 'E' },
});

describe('parseMap', () => {
  it('derives road connections and shapes from neighbors', () => {
    const map = parseMap(tiny(['.....', '.RRR.', '.R.R.', '.RRR.', '..R..']));
    const shape = (c: number, r: number) => roadShape(map.tileAt(c, r)!);
    expect(shape(1, 1)).toBe('curve');
    expect(map.tileAt(1, 1)!.connections).toEqual(['E', 'S']);
    expect(shape(2, 1)).toBe('straight');
    expect(shape(2, 3)).toBe('tJunction');
    expect(shape(2, 4)).toBe('deadEnd');
  });

  it('rejects a start position that is not on a road', () => {
    expect(() => parseMap({ ...tiny(['...', '.R.']), start: { col: 0, row: 0, heading: 'N' } })).toThrow();
  });

  it('rejects unknown characters', () => {
    expect(() => parseMap(tiny(['.X.', '.R.']))).toThrow();
  });

  it('parses the bundled town map with all road shapes', () => {
    const map = parseMap(TOWN_MAP);
    const shapes = new Set(map.tiles.filter((t) => t.kind === 'road').map(roadShape));
    expect(shapes).toEqual(new Set(['straight', 'curve', 'tJunction', 'crossroads']));
    const obstacles = buildObstacles(map);
    expect(obstacles.boxes.some((b) => b.kind === 'building')).toBe(true);
    expect(obstacles.cones.length).toBeGreaterThan(0);
  });
});
