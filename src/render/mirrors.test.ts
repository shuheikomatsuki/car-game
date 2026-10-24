import { describe, expect, it } from 'vitest';
import { centeredRegion, mirrorLayout } from './mirrors';

describe('mirror layout', () => {
  it('centers the rear mirror in the free space between the top buttons and the map', () => {
    const { rear } = mirrorLayout(844, { left: 235, right: 714, top: 10 }, 'rear');
    expect(Math.abs(rear.x + rear.w / 2 - (235 + 714) / 2)).toBeLessThanOrEqual(1);
    expect(rear.w).toBeLessThanOrEqual(714 - 235);
    expect(rear.h).toBe(Math.round(rear.w / 4));
  });

  it('puts side mirrors on both sides of the rear mirror without leaving the free space', () => {
    const region = { left: 438, right: 1394, top: 10 };
    const { rear, left, right } = mirrorLayout(1600, region, 'all');
    expect(left.x).toBeGreaterThanOrEqual(region.left);
    expect(right.x + right.w).toBeLessThanOrEqual(region.right);
    expect(left.x + left.w).toBeLessThan(rear.x);
    expect(right.x).toBeGreaterThan(rear.x + rear.w);
    expect(left.h).toBe(rear.h);
  });

  it('puts only the side mirrors at both ends of the free space', () => {
    const region = { left: 235, right: 714, top: 10 };
    const { left, right } = mirrorLayout(844, region, 'side');
    expect(left.x).toBe(region.left);
    expect(right.x + right.w).toBe(region.right);
    expect(left.x + left.w).toBeLessThan(right.x);
    expect(left.h).toBe(right.h);
    expect(left.h).toBeGreaterThan(0);
  });

  it('uses more of the width on a portrait screen', () => {
    const land = mirrorLayout(390, { left: 8, right: 382, top: 200 }, 'rear');
    const port = mirrorLayout(390, { left: 8, right: 382, top: 200 }, 'rear', true);
    expect(port.rear.w).toBeGreaterThan(land.rear.w);
  });

  it('keeps the mirror region centered on the screen, narrowed by the nearer side', () => {
    // 左のボタンは 230px まで、右の地図は 720px から（画面 844px）
    expect(centeredRegion(844, 230, 720, 8)).toEqual({ left: 230, right: 614, top: 8 });
    // 右側が近いとき
    expect(centeredRegion(1000, 50, 800, 8)).toEqual({ left: 200, right: 800, top: 8 });
    const { rear } = mirrorLayout(844, centeredRegion(844, 230, 720, 8), 'rear');
    expect(rear.x + rear.w / 2).toBeCloseTo(422, 0);
  });
});
