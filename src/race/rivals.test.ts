import { describe, expect, it } from 'vitest';
import { MAPS } from '../map/maps';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { NPC_LEVELS } from './npcDriver';
import { RIVALS } from './rivals';

describe('RIVALS', () => {
  it('drive existing cars on race courses at a known level', () => {
    for (const r of RIVALS) {
      expect(VEHICLE_PRESETS.some((v) => v.id === r.car)).toBe(true);
      expect(MAPS.find((m) => m.id === r.course)?.race).toBeTruthy();
      expect(NPC_LEVELS.some((l) => l.id === r.level)).toBe(true);
    }
    expect(new Set(RIVALS.map((r) => r.id)).size).toBe(RIVALS.length);
    // 得意なコースはライバルごとに別々
    expect(new Set(RIVALS.map((r) => r.course)).size).toBe(RIVALS.length);
  });

  it('give some rivals a favorite time and weather', () => {
    for (const id of ['kenta', 'sakamoto']) expect(RIVALS.find((r) => r.id === id)?.conditions).toEqual({ time: 'night', weather: 'rain' });
    expect(RIVALS.find((r) => r.id === 'takumi')?.conditions).toBeUndefined();
  });
});
