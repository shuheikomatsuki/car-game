import { describe, expect, it } from 'vitest';
import {
  type DriverInput,
  type VehicleState,
  DEFAULT_VEHICLE_PARAMS as P,
  NEUTRAL_INPUT,
  steerLimitAt,
  stepVehicle,
} from './vehicle';

const DT = 1 / 60;
const REST: VehicleState = { forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0 };

function run(state: VehicleState, input: Partial<DriverInput>, seconds: number) {
  let s = { ...state, yawRate: 0 };
  const full = { ...NEUTRAL_INPUT, ...input };
  for (let i = 0; i < Math.round(seconds / DT); i++) s = stepVehicle(s, full, P, DT);
  return s;
}

describe('stepVehicle', () => {
  it('accelerates forward with throttle and never exceeds max speed', () => {
    const after2s = run(REST, { throttle: 1 }, 2);
    expect(after2s.forwardSpeed).toBeGreaterThan(8);
    const after60s = run(REST, { throttle: 1 }, 60);
    expect(after60s.forwardSpeed).toBeLessThanOrEqual(P.maxForwardSpeed);
    expect(after60s.forwardSpeed).toBeGreaterThan(P.maxForwardSpeed * 0.8);
  });

  it('brakes to a stop from cruising speed within a few seconds', () => {
    const cruising = { ...REST, forwardSpeed: 20 };
    // 16 m/s^2 なら 1 秒で 20 → 4 m/s 程度まで落ちる
    const s = run(cruising, { brake: 1 }, 1.0);
    expect(s.forwardSpeed).toBeLessThan(5);
    expect(s.forwardSpeed).toBeGreaterThanOrEqual(0);
  });

  it('reverses when brake is held at standstill, up to max reverse speed', () => {
    const s = run(REST, { brake: 1 }, 20);
    expect(s.forwardSpeed).toBeLessThan(0);
    expect(s.forwardSpeed).toBeGreaterThanOrEqual(-P.maxReverseSpeed);
  });

  it('throttle while reversing acts as a brake first', () => {
    const reversing = { ...REST, forwardSpeed: -5 };
    const s = run(reversing, { throttle: 1 }, 0.1);
    expect(s.forwardSpeed).toBeGreaterThan(-5);
    expect(s.forwardSpeed).toBeLessThanOrEqual(0);
  });

  it('coasts to a stop without reversing direction', () => {
    const s = run({ ...REST, forwardSpeed: 10 }, {}, 60);
    expect(s.forwardSpeed).toBe(0);
  });

  it('turns left with positive steer and right with negative steer', () => {
    const moving = { ...REST, forwardSpeed: 10 };
    const left = run(moving, { throttle: 0.3, steer: 1 }, 0.5);
    const right = run(moving, { throttle: 0.3, steer: -1 }, 0.5);
    expect(left.yawRate).toBeGreaterThan(0);
    expect(right.yawRate).toBeLessThan(0);
    expect(left.yawRate).toBeCloseTo(-right.yawRate, 6);
  });

  it('does not rotate when standing still even with full steer', () => {
    const s = run(REST, { steer: 1 }, 1);
    expect(s.yawRate).toBe(0);
    expect(s.steerAngle).toBeCloseTo(P.maxSteerAngle, 6);
  });

  it('returns the steering to center when released', () => {
    const steered = run({ ...REST, forwardSpeed: 5 }, { steer: 1 }, 1);
    expect(steered.steerAngle).toBeGreaterThan(0.3);
    const released = run(steered, {}, 1);
    expect(released.steerAngle).toBe(0);
  });

  it('limits the steering angle at high speed', () => {
    expect(steerLimitAt(0, P)).toBe(P.maxSteerAngle);
    expect(steerLimitAt(30, P)).toBeLessThan(steerLimitAt(10, P));
    // 高速旋回時の横加速度が上限以下
    const v = 30;
    const lateral = (v * v * Math.tan(steerLimitAt(v, P))) / P.wheelBase;
    expect(lateral).toBeLessThanOrEqual(P.maxLateralAccel + 1e-9);
  });

  it('damps lateral sliding', () => {
    const s = run({ ...REST, forwardSpeed: 10, lateralSpeed: 5 }, {}, 1);
    expect(Math.abs(s.lateralSpeed)).toBeLessThan(0.01);
  });
});

describe('steering feel', () => {
  it('turns the wheel more gently at high speed', () => {
    const slow = stepVehicle({ ...REST, forwardSpeed: 3 }, { ...NEUTRAL_INPUT, steer: 1 }, P, DT);
    const fast = stepVehicle({ ...REST, forwardSpeed: 28 }, { ...NEUTRAL_INPUT, steer: 1 }, P, DT);
    expect(fast.steerAngle).toBeLessThan(slow.steerAngle);
    expect(fast.steerAngle).toBeGreaterThan(0);
  });
});
