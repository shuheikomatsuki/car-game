import { describe, expect, it } from 'vitest';
import { MAPS, SCHOOL_MAP, TOWN_MAP } from './maps';
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

  it.each(MAPS.map((m) => [m.name, m] as const))('parses bundled map %s', (_, def) => {
    const map = parseMap(def);
    // すべての道路が少なくとも2方向につながっている（行き止まりや孤立した道路がない）
    for (const t of map.tiles.filter((t) => t.kind === 'road')) {
      expect(t.connections.length, `road at (${t.col}, ${t.row})`).toBeGreaterThanOrEqual(2);
    }
    expect(buildObstacles(map).signs.length).toBe(def.signs?.length ?? 0);
  });

  it('places guardrails along the outside of curves only when enabled', () => {
    const rails = (def: MapDefinition) =>
      buildObstacles(parseMap(def)).boxes.filter((b) => b.kind === 'guardrail');
    expect(rails(TOWN_MAP)).toHaveLength(0);
    const school = parseMap(SCHOOL_MAP);
    const curves = school.tiles.filter((t) => t.kind === 'road' && roadShape(t) === 'curve');
    const schoolRails = rails(SCHOOL_MAP);
    expect(schoolRails.length).toBe(curves.length * 6);
    // ガードレールは道路の外側（道路中心線から道路幅の半分以上離れた位置）にある
    const { tileSize, roadWidth } = SCHOOL_MAP;
    for (const r of schoolRails) {
      const col = Math.round(r.x / tileSize);
      const row = Math.round(r.z / tileSize);
      const tile = school.tileAt(col, row)!;
      const sx = tile.connections.includes('E') ? 1 : -1;
      const sz = tile.connections.includes('S') ? 1 : -1;
      const dist = Math.hypot(r.x - (col + sx / 2) * tileSize, r.z - (row + sz / 2) * tileSize);
      expect(dist).toBeGreaterThan(tileSize / 2 + roadWidth / 2);
    }
  });
});
