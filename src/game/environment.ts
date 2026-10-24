import type { VehicleParams } from '../sim/vehicle';

/** 時間帯 */
export type TimeOfDay = 'morning' | 'day' | 'night';
/** 天気 */
export type Weather = 'clear' | 'rain' | 'fog';

export interface Environment {
  time: TimeOfDay;
  weather: Weather;
}

export const TIMES_OF_DAY: readonly { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: '朝' },
  { id: 'day', label: '昼' },
  { id: 'night', label: '夜' },
];

export const WEATHERS: readonly { id: Weather; label: string; note?: string }[] = [
  { id: 'clear', label: '普通' },
  { id: 'rain', label: '雨', note: '滑りやすい' },
  { id: 'fog', label: '霧', note: '先が見えにくい' },
];

export const DEFAULT_ENVIRONMENT: Environment = { time: 'day', weather: 'clear' };

/**
 * 相手（NPC・ライバル）のライトを最初につけておくか: 夜と雨・霧はつける、晴れた朝・昼は消す
 * （時間帯・天気の画面で、どの条件でも選び直せる）
 */
export function defaultOpponentLights(env: Environment): boolean {
  return env.time === 'night' || env.weather !== 'clear';
}

/** 雨の日のタイヤのグリップ（横に踏ん張る力）とブレーキの効きの割合 */
export const RAIN_GRIP = 0.78;
export const RAIN_BRAKE = 0.8;

/** 天気に合わせた車の性能（雨は滑りやすく、ブレーキも効きにくい） */
export function paramsForWeather(params: Readonly<VehicleParams>, weather: Weather): VehicleParams {
  if (weather !== 'rain') return { ...params };
  return {
    ...params,
    maxLateralAccel: params.maxLateralAccel * RAIN_GRIP,
    lateralGrip: params.lateralGrip * RAIN_GRIP,
    brakeDecel: params.brakeDecel * RAIN_BRAKE,
  };
}

const KEY = 'car-game:environment';

export function loadEnvironment(): Environment {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const { time, weather } = v as Record<string, unknown>;
      return {
        time: TIMES_OF_DAY.some((t) => t.id === time) ? (time as TimeOfDay) : DEFAULT_ENVIRONMENT.time,
        weather: WEATHERS.some((w) => w.id === weather) ? (weather as Weather) : DEFAULT_ENVIRONMENT.weather,
      };
    }
  } catch {
    // 読めなければ初期設定
  }
  return { ...DEFAULT_ENVIRONMENT };
}

export function saveEnvironment(env: Environment): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    // 保存できなくても遊ぶのには困らない
  }
}
