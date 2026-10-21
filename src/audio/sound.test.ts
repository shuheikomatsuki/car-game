import { describe, expect, it } from 'vitest';
import { engineTone } from './sound';

describe('engineTone', () => {
  it('idles at a low pitch when stopped', () => {
    const idle = engineTone(0, 0);
    expect(idle.gear).toBe(0);
    expect(idle.frequency).toBeLessThan(engineTone(5, 1).frequency);
  });

  it('shifts up and drops rpm when crossing a gear threshold', () => {
    const before = engineTone(6.9, 1);
    const after = engineTone(7.1, 1);
    expect(after.gear).toBe(before.gear + 1);
    expect(after.rpm).toBeLessThan(before.rpm);
  });

  it('is louder and brighter with throttle', () => {
    expect(engineTone(10, 1).gain).toBeGreaterThan(engineTone(10, 0).gain);
    expect(engineTone(10, 1).cutoff).toBeGreaterThan(engineTone(10, 0).cutoff);
  });

  it('treats reverse speed like forward speed', () => {
    expect(engineTone(-5, 0.5)).toEqual(engineTone(5, 0.5));
  });
});
