import { describe, expect, it } from 'vitest';
import { carStyle, driverEyeFor } from './carMesh';

describe('driver eye', () => {
  it('keeps the eye behind the roof edge on ordinary cars', () => {
    expect(driverEyeFor(carStyle('ae86')).z).toBeCloseTo(0.05);
    expect(driverEyeFor(carStyle('s13')).z).toBeCloseTo(-0.05);
  });

  it('moves the eye up to the windscreen on a car with a small window', () => {
    // 屋根の縁の 0.3m 後ろ（-0.42）まで下がると、画面の下半分が車内になる
    const eye = driverEyeFor(carStyle('cappuccino'));
    expect(eye.z).toBeGreaterThan(-0.1);
    expect(eye.z).toBeLessThan(0.05);
  });
});
