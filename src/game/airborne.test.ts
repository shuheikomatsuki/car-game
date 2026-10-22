import { describe, expect, it } from 'vitest';
import { Airborne } from './airborne';

const DT = 1 / 60;

describe('Airborne', () => {
  it('follows gentle slopes without leaving the ground', () => {
    const a = new Airborne();
    for (let i = 0; i < 300; i++) {
      // 止まった状態から 8m/s^2 で加速しながら 15% の坂を下る
      const t = i * DT;
      a.update(DT, -0.15 * 4 * t * t);
      expect(a.inAir).toBe(false);
    }
  });

  it('flies off a step and lands a little later', () => {
    const a = new Airborne();
    a.update(DT, 0);
    a.update(DT, 0);
    // 2m の段差を降りる
    let flight = 0;
    let landing: number | null = null;
    for (let i = 0; i < 120 && landing === null; i++) {
      landing = a.update(DT, -2);
      if (a.inAir) flight += DT;
    }
    expect(flight).toBeGreaterThan(0.4);
    expect(flight).toBeLessThan(0.8);
    expect(landing).toBeGreaterThan(5);
    expect(a.gap).toBe(0);
  });
});
