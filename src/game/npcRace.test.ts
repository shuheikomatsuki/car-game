import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_PARAMS } from '../sim/vehicle';
import { NPC_LEVELS } from '../race/npcDriver';
import { npcEntries } from './npcRace';

describe('npc entries', () => {
  it('shuffles the starting order but keeps each name with its color', () => {
    const fixed = npcEntries(3, NPC_LEVELS[0], DEFAULT_VEHICLE_PARAMS, undefined, () => 0.99);
    const mixed = npcEntries(3, NPC_LEVELS[0], DEFAULT_VEHICLE_PARAMS, undefined, () => 0);
    expect(fixed.map((e) => e.name)).toEqual(['ハヤテ', 'カエデ', 'ツバサ']);
    expect(mixed.map((e) => e.name)).toEqual(['カエデ', 'ツバサ', 'ハヤテ']);
    for (const e of mixed) expect(e).toEqual(fixed.find((f) => f.name === e.name));
  });
});
