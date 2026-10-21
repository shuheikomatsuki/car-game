import { describe, expect, it } from 'vitest';
import { PAD_BUTTON, gamepadToDriverInput, mergeInputs } from './input';

function buttons(values: Partial<Record<number, number>>): number[] {
  return Array.from({ length: 17 }, (_, i) => values[i] ?? 0);
}

describe('gamepadToDriverInput', () => {
  it('maps triggers to throttle/brake and the left stick to steering', () => {
    const input = gamepadToDriverInput(
      [-1, 0, 0, 0],
      buttons({ [PAD_BUTTON.rightTrigger]: 0.6, [PAD_BUTTON.leftTrigger]: 0.3 }),
    );
    expect(input.throttle).toBeCloseTo(0.6);
    expect(input.brake).toBeCloseTo(0.3);
    // スティック左いっぱい → 左にハンドル（正）
    expect(input.steer).toBeCloseTo(1);
  });

  it('ignores small stick drift', () => {
    expect(gamepadToDriverInput([0.08, 0], buttons({})).steer).toBe(0);
    expect(gamepadToDriverInput([0.5, 0], buttons({})).steer).toBeLessThan(0);
  });
});

describe('mergeInputs', () => {
  it('takes the stronger of keyboard and gamepad inputs', () => {
    const merged = mergeInputs(
      { throttle: 1, brake: 0, steer: 0 },
      { throttle: 0.2, brake: 0.5, steer: -0.4 },
    );
    expect(merged).toEqual({ throttle: 1, brake: 0.5, steer: -0.4 });
  });

  it('returns keyboard input when no gamepad is connected', () => {
    const kb = { throttle: 0, brake: 1, steer: 1 };
    expect(mergeInputs(kb, null)).toBe(kb);
  });
});
