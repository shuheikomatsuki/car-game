/**
 * キャラクターの「運転の苦手さ」。数値を変えるだけで難易度を調整できる。
 * 理不尽にならないよう、緊急の指示（止まって・危ない）には失敗させない。
 */
export interface Personality {
  id: string;
  label: string;
  /** 通常の指示に反応するまでの時間 [s]（最小, 最大） */
  reactionDelay: [number, number];
  /** 緊急の指示に反応するまでの時間 [s] */
  emergencyDelay: [number, number];
  /** 右左折の指示を逆に聞き間違える確率 */
  mishearChance: number;
  /** 交差点で曲がる方向を間違える確率 */
  wrongTurnChance: number;
  /** 走行中に意味もなくブレーキを踏む頻度 [回/分] */
  suddenBrakePerMinute: number;
  /** ハンドルのふらつきの大きさ（-1..1 の入力に足す量） */
  steerWobble: number;
}

export const PERSONALITIES: readonly Personality[] = [
  {
    // 指示どおりに走る。苦手さは反応の遅れと少しのふらつきだけ
    id: 'normal',
    label: 'ふつう',
    reactionDelay: [0.4, 0.8],
    emergencyDelay: [0.1, 0.2],
    mishearChance: 0,
    wrongTurnChance: 0,
    suddenBrakePerMinute: 0,
    steerWobble: 0.04,
  },
  {
    id: 'easy',
    label: 'やさしい',
    reactionDelay: [0.25, 0.45],
    emergencyDelay: [0.08, 0.12],
    mishearChance: 0,
    wrongTurnChance: 0,
    suddenBrakePerMinute: 0,
    steerWobble: 0.02,
  },
  {
    id: 'hard',
    label: 'にがて',
    // 聞き間違い・曲がり間違い・急ブレーキが入る（ドタバタを楽しむ用）
    reactionDelay: [0.8, 1.6],
    emergencyDelay: [0.2, 0.35],
    mishearChance: 0.2,
    wrongTurnChance: 0.12,
    suddenBrakePerMinute: 1,
    steerWobble: 0.12,
  },
];

/** 毎回同じ乱数列を作れる簡単な乱数（テストで再現できるように） */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(rng: () => number, [min, max]: [number, number]): number {
  return min + (max - min) * rng();
}
