import { describe, expect, it } from 'vitest';
import { anyTouchInside } from './touchControls';

describe('anyTouchInside', () => {
  const rect = { left: 100, top: 100, right: 200, bottom: 240 };

  it('finds a finger on or near the button', () => {
    expect(anyTouchInside(rect, [{ clientX: 150, clientY: 150 }])).toBe(true);
    expect(anyTouchInside(rect, [{ clientX: 220, clientY: 260 }], 48)).toBe(true);
  });

  it('treats the pedal as released when no finger is left on it', () => {
    expect(anyTouchInside(rect, [])).toBe(false);
    expect(anyTouchInside(rect, [{ clientX: 10, clientY: 300 }])).toBe(false);
  });
});
