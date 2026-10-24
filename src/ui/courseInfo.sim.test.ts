import { beforeAll, describe, expect, it } from 'vitest';
import { Track } from '../game/track';
import { MAPS } from '../map/maps';
import { buildRacingLine, buildSpeedProfile, profileTime } from '../race/racingLine';
import { type Rapier, loadRapier } from '../sim/physics';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { COURSE_NOTES } from './courseInfo';

let rapier: Rapier;

beforeAll(async () => {
  rapier = await loadRapier();
});

describe('recommended cars', () => {
  it.each(MAPS.filter((m) => m.race).map((m) => [m.name, m] as const))('are among the fastest on %s', (_, def) => {
    const track = new Track(rapier, def);
    const line = buildRacingLine(track.course!);
    const gradient = track.hasSlopes ? (x: number, z: number, s: number) => track.slopeAt(x, z, s) : undefined;
    // レーシングラインを限界で走ったときの理論タイム
    const time = (id: string) => {
      const p = VEHICLE_PRESETS.find((v) => v.id === id)!.params;
      return profileTime(line, buildSpeedProfile(line, p, { grip: 1, brake: 1, gradient }));
    };
    const best = Math.min(...VEHICLE_PRESETS.map((v) => time(v.id)));
    for (const car of COURSE_NOTES[def.id].cars) expect(time(car) / best, car).toBeLessThan(1.04);
  });
});
