import { describe, expect, it } from 'vitest';
import { mirrorLayout } from './mirrors';

describe('mirror layout', () => {
  it('centers the rear mirror in the free space between the top buttons and the map', () => {
    const { rear } = mirrorLayout(844, { left: 235, right: 714, top: 10 }, false);
    expect(Math.abs(rear.x + rear.w / 2 - (235 + 714) / 2)).toBeLessThanOrEqual(1);
    expect(rear.w).toBeLessThanOrEqual(714 - 235);
    expect(rear.h).toBe(Math.round(rear.w / 4));
  });

  it('puts side mirrors on both sides of the rear mirror without leaving the free space', () => {
    const region = { left: 438, right: 1394, top: 10 };
    const { rear, left, right } = mirrorLayout(1600, region, true);
    expect(left.x).toBeGreaterThanOrEqual(region.left);
    expect(right.x + right.w).toBeLessThanOrEqual(region.right);
    expect(left.x + left.w).toBeLessThan(rear.x);
    expect(right.x).toBeGreaterThan(rear.x + rear.w);
    expect(left.h).toBe(rear.h);
  });

  it('uses more of the width on a portrait screen', () => {
    const land = mirrorLayout(390, { left: 8, right: 382, top: 200 }, false);
    const port = mirrorLayout(390, { left: 8, right: 382, top: 200 }, false, true);
    expect(port.rear.w).toBeGreaterThan(land.rear.w);
  });
});
