import { describe, expect, it } from 'vitest';
import { nearestLit } from './headlights';

describe('nearestLit', () => {
  const car = (id: number, x: number, lit = true) => ({ id, x, z: 0, lit });

  it('picks the nearest cars with their lights on', () => {
    const cars = [car(1, 50), car(2, 10), car(3, 5, false), car(4, 30)];
    expect(nearestLit(cars, 0, 0, 2).map((c) => c.id)).toEqual([2, 4]);
  });

  it('ignores cars that are too far away', () => {
    expect(nearestLit([car(1, 400), car(2, 100)], 0, 0, 2, 150).map((c) => c.id)).toEqual([2]);
    expect(nearestLit([], 0, 0)).toEqual([]);
  });
});
