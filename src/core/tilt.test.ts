import { describe, expect, it } from 'vitest';
import { TILT_FULL_LOCK, rollAngle, tiltSteer } from './tilt';

const G = 9.8;
/** 端末を時計回りに angle [rad] 回したときの加速度センサーの値 */
const reading = (angle: number, flip = 1) => [-G * Math.sin(angle) * flip, G * Math.cos(angle) * flip] as const;

describe('rollAngle', () => {
  it('measures how far the device is turned clockwise', () => {
    expect(rollAngle(...reading(0))).toBeCloseTo(0);
    expect(rollAngle(...reading(0.3))).toBeCloseTo(0.3);
    expect(rollAngle(...reading(-0.5))).toBeCloseTo(-0.5);
  });

  it('gives up while the device lies almost flat', () => {
    expect(rollAngle(0.5, 1)).toBeNull();
  });
});

describe('tiltSteer', () => {
  it('ignores a small tilt around the neutral hold', () => {
    expect(tiltSteer(0.02, 0)).toBe(0);
    expect(tiltSteer(1.52, 1.5)).toBe(0);
  });

  it('steers right (negative) when turned clockwise, and reaches full lock', () => {
    expect(tiltSteer(0.2, 0)).toBeLessThan(0);
    expect(tiltSteer(-0.2, 0)).toBeGreaterThan(0);
    expect(tiltSteer(TILT_FULL_LOCK, 0)).toBeCloseTo(-1);
    expect(tiltSteer(-2, 0)).toBe(1);
  });

  it('is gentle near the middle so small corrections do not over-steer', () => {
    expect(Math.abs(tiltSteer(TILT_FULL_LOCK / 2, 0))).toBeLessThan(0.4);
    expect(Math.abs(tiltSteer(TILT_FULL_LOCK / 4, 0))).toBeLessThan(0.15);
  });

  it('works across the ±180° boundary', () => {
    expect(tiltSteer(-Math.PI + 0.1, Math.PI - 0.1)).toBeLessThan(0);
  });

  it('keeps the turning direction on devices that report every axis reversed', () => {
    const neutral = rollAngle(...reading(0.1, -1))!;
    expect(tiltSteer(rollAngle(...reading(0.4, -1))!, neutral)).toBeLessThan(0);
    expect(tiltSteer(rollAngle(...reading(-0.2, -1))!, neutral)).toBeGreaterThan(0);
  });
});
