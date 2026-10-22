import { describe, expect, it } from 'vitest';
import { STEER_RADIUS_PX, knobOffset, steerFromDrag } from './touch';

describe('steerFromDrag', () => {
  it('ignores small finger movements', () => {
    expect(steerFromDrag(0)).toBe(0);
    expect(steerFromDrag(3)).toBe(0);
    expect(steerFromDrag(-3)).toBe(0);
  });

  it('steers right (negative) when dragging right, left when dragging left', () => {
    expect(steerFromDrag(STEER_RADIUS_PX / 2)).toBeLessThan(0);
    expect(steerFromDrag(-STEER_RADIUS_PX / 2)).toBeGreaterThan(0);
    expect(steerFromDrag(20)).toBeCloseTo(-steerFromDrag(-20));
  });

  it('reaches full lock at the radius and stays there', () => {
    expect(steerFromDrag(STEER_RADIUS_PX)).toBeCloseTo(-1);
    expect(steerFromDrag(-STEER_RADIUS_PX * 3)).toBeCloseTo(1);
  });

  it('grows smoothly from the dead zone', () => {
    const a = steerFromDrag(10);
    const b = steerFromDrag(30);
    expect(Math.abs(a)).toBeLessThan(Math.abs(b));
    expect(Math.abs(a)).toBeLessThan(0.15);
  });
});

describe('knobOffset', () => {
  it('follows the finger up to the radius', () => {
    expect(knobOffset(20)).toBe(20);
    expect(knobOffset(500)).toBe(STEER_RADIUS_PX);
    expect(knobOffset(-500)).toBe(-STEER_RADIUS_PX);
  });
});
