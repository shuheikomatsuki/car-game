import { describe, expect, it } from 'vitest';
import { isBoardKey } from '../net/leaderboard';
import { HAPPOGAHARA_MAP, MAPS } from './maps';
import { courseIdOfKey, courseKey, courseRevision } from './courseRevision';

describe('courseRevision', () => {
  it('gives every course a key the ranking server accepts', () => {
    for (const m of MAPS) {
      expect(isBoardKey(courseKey(m)), courseKey(m)).toBe(true);
      expect(courseIdOfKey(courseKey(m))).toBe(m.id);
    }
  });

  it('stays the same when only the name or the signs change', () => {
    expect(courseRevision({ ...HAPPOGAHARA_MAP, name: '別の名前', signs: [] })).toBe(courseRevision(HAPPOGAHARA_MAP));
  });

  it('changes when the shape of the road changes', () => {
    const road = HAPPOGAHARA_MAP.road!;
    const changed = { ...HAPPOGAHARA_MAP, road: { ...road, pieces: [...road.pieces.slice(0, -1), { straight: 100 }] } };
    expect(courseRevision(changed)).not.toBe(courseRevision(HAPPOGAHARA_MAP));
  });

  it('ignores tiny rounding differences in computed coordinates', () => {
    const road = HAPPOGAHARA_MAP.road!;
    const nudged = { ...HAPPOGAHARA_MAP, road: { ...road, start: road.start + 1e-9 } };
    expect(courseRevision(nudged)).toBe(courseRevision(HAPPOGAHARA_MAP));
  });
});
