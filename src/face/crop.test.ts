import { describe, expect, it } from 'vitest';
import { clampView, fitView, minScale, zoomAt } from './crop';

describe('face crop view', () => {
  it('fits the short side of the image to the frame and centers it', () => {
    expect(fitView(800, 400, 200)).toEqual({ scale: 0.5, x: -100, y: 0 });
    expect(fitView(300, 600, 300)).toEqual({ scale: 1, x: 0, y: -150 });
  });

  it('keeps the frame covered by the image', () => {
    const v = clampView({ scale: 0.1, x: 50, y: 50 }, 800, 400, 200);
    expect(v.scale).toBe(minScale(800, 400, 200));
    expect(v.x).toBeLessThanOrEqual(0);
    expect(v.y).toBe(0);
    const panned = clampView({ scale: 1, x: -2000, y: 30 }, 800, 400, 200);
    expect(panned).toEqual({ scale: 1, x: -600, y: 0 });
  });

  it('zooms around the pointer', () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50);
    // 拡大前に (100, 50) にあった画像の点は拡大後も (100, 50) にある
    expect(100 * v.scale + v.x).toBe(100);
    expect(50 * v.scale + v.y).toBe(50);
    expect(v).toEqual({ scale: 2, x: -100, y: -50 });
  });
});
