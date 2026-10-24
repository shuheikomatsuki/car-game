import { describe, expect, it } from 'vitest';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { defaultOpponentLights, paramsForWeather } from './environment';

describe('paramsForWeather', () => {
  const params = VEHICLE_PRESETS[0].params;

  it('keeps the car as it is in clear weather and fog', () => {
    expect(paramsForWeather(params, 'clear')).toEqual(params);
    expect(paramsForWeather(params, 'fog')).toEqual(params);
  });

  it('makes the tyres slip and the brakes weaker in the rain', () => {
    const wet = paramsForWeather(params, 'rain');
    expect(wet.maxLateralAccel).toBeLessThan(params.maxLateralAccel);
    expect(wet.lateralGrip).toBeLessThan(params.lateralGrip);
    expect(wet.brakeDecel).toBeLessThan(params.brakeDecel);
    expect(wet.maxForwardSpeed).toBe(params.maxForwardSpeed);
  });
});

describe('defaultOpponentLights', () => {
  it('turns the lights off on clear mornings and days only', () => {
    expect(defaultOpponentLights({ time: 'morning', weather: 'clear' })).toBe(false);
    expect(defaultOpponentLights({ time: 'day', weather: 'clear' })).toBe(false);
    expect(defaultOpponentLights({ time: 'day', weather: 'rain' })).toBe(true);
    expect(defaultOpponentLights({ time: 'morning', weather: 'fog' })).toBe(true);
    expect(defaultOpponentLights({ time: 'night', weather: 'clear' })).toBe(true);
  });
});
