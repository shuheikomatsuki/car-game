import { NPC_LEVELS, type NpcLevel } from './npcDriver';

/**
 * 1対1でバトルする名前付きのライバル。それぞれ自分の車と得意なコースを持つ。
 * バトルはライバルの得意なコースで、ライバルと横に並んでスタートする（自分の車は自由に選べる）。
 * 得意なコースはライバルごとに別々（イニシャルDでバトルした峠に近いコース）。
 */
export interface Rival {
  /** 変わらない id（勝ったかどうかの保存に使う） */
  id: string;
  name: string;
  /** 所属チーム */
  team: string;
  /** 車の id（VEHICLE_PRESETS） */
  car: string;
  /** 得意なコース（MapDefinition.id） */
  course: string;
  /** 強さ（NPC_LEVELS の id） */
  level: string;
}

/** 弱い順 */
export const RIVALS: readonly Rival[] = [
  { id: 'itsuki', name: '武内樹', team: '秋名スピードスターズ', car: 'ae85', course: 'circuit-gp', level: 'easy' },
  { id: 'iketani', name: '池谷浩一郎', team: '秋名スピードスターズ', car: 's13', course: 'valley-up', level: 'easy' },
  { id: 'kenta', name: '中村賢太', team: '赤城レッドサンズ', car: 's14', course: 'straight-up-r', level: 'normal' },
  { id: 'shingo', name: '庄司慎吾', team: '妙義ナイトキッズ', car: 'eg6', course: 'pass-over-r', level: 'normal' },
  { id: 'nakazato', name: '中里毅', team: '妙義ナイトキッズ', car: 'gtr', course: 'straight-down-r', level: 'hard' },
  { id: 'iwaki', name: '岩城清次', team: 'チームエンペラー', car: 'evo', course: 'uturn', level: 'hard' },
  { id: 'sakamoto', name: '坂本', team: 'カプチーノ使い', car: 'cappuccino', course: 'technical-circuit', level: 'hard' },
  { id: 'keisuke', name: '高橋啓介', team: '赤城レッドサンズ', car: 'fd3s', course: 'pass-up', level: 'pro' },
  { id: 'sudo', name: '須藤京一', team: 'チームエンペラー', car: 'evo3', course: 'hairpin-down', level: 'pro' },
  { id: 'hoshino', name: '星野好造', team: 'パープルシャドウ', car: 'r34', course: 'long-r', level: 'legend' },
  { id: 'tachi', name: '舘智幸', team: 'プロレーサー', car: 'ek9', course: 'happogahara', level: 'legend' },
  { id: 'rin', name: '北条凛', team: '死神', car: 'gtr', course: 'marathon', level: 'legend' },
  { id: 'takumi', name: '藤原拓海', team: '藤原とうふ店', car: 'ae86', course: 'pass-down', level: 'legend' },
];

export function rivalLevel(rival: Rival): NpcLevel {
  return NPC_LEVELS.find((l) => l.id === rival.level) ?? NPC_LEVELS[NPC_LEVELS.length - 1];
}

const BEATEN_KEY = 'car-game:beaten-rivals';

/** 勝ったことのあるライバルの id */
export function loadBeatenRivals(): Set<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(BEATEN_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markRivalBeaten(id: string): void {
  const set = loadBeatenRivals();
  set.add(id);
  try {
    localStorage.setItem(BEATEN_KEY, JSON.stringify([...set]));
  } catch {
    // 保存できなくても遊ぶのには困らない
  }
}
