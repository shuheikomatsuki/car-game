/**
 * ライバルとのバトルのセリフ（字幕）。セリフの中身と出す条件は src/race/dialogueScript.ts に書く。
 *
 * - intro: スタート前の場面（タップ・Enter で次のセリフへ）
 * - race: 走っている途中のセリフ（条件を満たしたときに、画面の下に字幕で出す）
 * - win / lose / draw: 勝った・負けた・引き分け（先行後追い）のあとの場面
 *
 * 場面（intro / win / lose / draw）は、条件（when）に合う最初のものを使う。
 */

import type { TimeOfDay, Weather } from '../game/environment';

/**
 * 1つのセリフ。who はライバルの id（'takumi' など）、'player'（自分）、'sfx'（効果音の字幕。名前を出さない）、
 * CHARACTERS の id、またはそのまま出す名前。text の \n で改行する
 */
export interface DialogueLine {
  who: string;
  text: string;
  /** このセリフを出すときに鳴らす効果音（public/sounds/<名前>.mp3。無ければ用意してある音: 'slap'） */
  sound?: string;
}

/** 数の範囲（min 以上・max 以下。片方だけでもよい） */
export interface Range {
  min?: number;
  max?: number;
}

type OneOrMany<T> = T | readonly T[];

/** 場面にもセリフにも使える条件。書いたものすべてを満たすときだけ出す */
export interface SceneCondition {
  /** 自分の車の id（'ae86' など。複数なら配列） */
  playerCar?: OneOrMany<string>;
  /** バトルの方式: 'side'（横に並んでスタート）か 'suddenDeath'（先行後追い） */
  rule?: 'side' | 'suddenDeath';
  /** 先行後追いで自分が先行か（true）・後追いか（false） */
  playerLeads?: boolean;
  /** 先行後追いの何本目か（1 から） */
  round?: number;
  /** 天気: 'clear' | 'rain' | 'fog' */
  weather?: OneOrMany<Weather>;
  /** 時間帯: 'morning' | 'day' | 'night' */
  time?: OneOrMany<TimeOfDay>;
}

/**
 * 走っている途中の出来事:
 * 'overtake'（自分がライバルを抜いた）、'overtaken'（ライバルに抜かれた）、'crash'（自分が壁に強くぶつかった）
 */
export type BattleEvent = 'overtake' | 'overtaken' | 'crash';

export interface RaceCondition extends SceneCondition {
  /** この出来事が起きたとき */
  event?: BattleEvent;
  /** スタートラインからこの距離 [m] の場所を通ったとき（周回コースは周ごとの距離） */
  at?: number;
  /** 何周目か（1 から） */
  lap?: number;
  /** 自分がライバルの前にいる（'ahead'）か後ろにいる（'behind'）か */
  position?: 'ahead' | 'behind';
  /** 自分とライバルの差 [m] */
  gap?: Range;
  /** 自分の速さ [km/h] */
  speed?: Range;
  /** スタートしてからの時間 [秒] */
  elapsed?: Range;
  /** レース全体のうち進んだ割合（0 = スタート、1 = ゴール）。終盤なら { min: 0.7 } */
  progress?: Range;
}

export interface Scene {
  when?: SceneCondition;
  say: readonly DialogueLine[];
}

export interface RaceLine {
  when: RaceCondition;
  say: readonly DialogueLine[];
  /** 1回のバトルで何度も出してよいか（書かなければ1回だけ）。何度も出すときは、条件を満たさなくなってから再び満たしたときに出す */
  repeat?: boolean;
}

export interface RivalDialogue {
  /** ライバルの得意なコースのときだけセリフを出すか（書かなければ true） */
  onlyHomeCourse?: boolean;
  /** このバトルでセリフを出す条件（自分の車など）。満たさなければ、どのセリフも出さない */
  when?: SceneCondition;
  intro?: readonly Scene[];
  race?: readonly RaceLine[];
  win?: readonly Scene[];
  lose?: readonly Scene[];
  draw?: readonly Scene[];
}

/** バトル全体で変わらないこと */
export interface BattleContext {
  course: string;
  homeCourse: string;
  playerCar: string;
  rule: 'side' | 'suddenDeath';
  playerLeads: boolean;
  round: number;
  weather: Weather;
  time: TimeOfDay;
}

/** 走っている途中の、毎ステップの様子 */
export interface BattleSnapshot {
  /** スタートしてからの時間 [s] */
  elapsed: number;
  /** いまの周（1 から） */
  lap: number;
  /** いまの周のスタートラインからの距離 [m] */
  lapDistance: number;
  /** 自分がライバルより前にいるか */
  ahead: boolean;
  /** 自分とライバルの差 [m] */
  gap: number;
  /** 自分の速さ [km/h] */
  speedKmh: number;
  /** レース全体のうち自分が進んだ割合（0..1） */
  progress: number;
  /** このステップで起きた出来事 */
  events: readonly BattleEvent[];
}

const includes = <T>(want: OneOrMany<T> | undefined, value: T) =>
  want === undefined || (Array.isArray(want) ? want.includes(value) : want === value);

const inRange = (r: Range | undefined, v: number) => !r || ((r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max));

export function matchesScene(when: SceneCondition | undefined, ctx: BattleContext): boolean {
  if (!when) return true;
  return (
    includes(when.playerCar, ctx.playerCar) &&
    includes(when.rule, ctx.rule) &&
    (when.playerLeads === undefined || (ctx.rule === 'suddenDeath' && when.playerLeads === ctx.playerLeads)) &&
    (when.round === undefined || when.round === ctx.round) &&
    includes(when.weather, ctx.weather) &&
    includes(when.time, ctx.time)
  );
}

/** このバトルでセリフを出すか（得意なコースか・自分の車などの条件） */
export function dialogueApplies(d: RivalDialogue | undefined, ctx: BattleContext): d is RivalDialogue {
  if (!d) return false;
  if ((d.onlyHomeCourse ?? true) && ctx.course !== ctx.homeCourse) return false;
  return matchesScene(d.when, ctx);
}

/** 場面のセリフ（条件に合う最初の場面。無ければ空） */
export function sceneLines(scenes: readonly Scene[] | undefined, ctx: BattleContext): readonly DialogueLine[] {
  return scenes?.find((s) => matchesScene(s.when, ctx))?.say ?? [];
}

/** 走っている途中のセリフを、条件を見ながら出していく（1回のバトルの1本ごとに作る） */
export class BattleDialogue {
  private readonly said = new Set<number>();
  private readonly wasMatching: boolean[];
  private lastDistance: number | null = null;
  private lastLap = 1;

  constructor(
    private readonly lines: readonly RaceLine[],
    private readonly ctx: BattleContext,
  ) {
    this.wasMatching = lines.map(() => false);
  }

  /** 毎ステップ呼ぶ。いま出すセリフを返す */
  update(s: BattleSnapshot): DialogueLine[] {
    const out: DialogueLine[] = [];
    const prev = this.lastLap === s.lap ? this.lastDistance : null;
    this.lines.forEach((line, i) => {
      const matching = this.matches(line.when, s, prev);
      // 場所や出来事の条件は「その瞬間」なので、毎回が新しく満たしたことになる
      const instant = line.when.at !== undefined || line.when.event !== undefined;
      const rising = matching && (instant || !this.wasMatching[i]);
      this.wasMatching[i] = matching;
      if (!rising) return;
      if (!line.repeat && this.said.has(i)) return;
      this.said.add(i);
      out.push(...line.say);
    });
    this.lastDistance = s.lapDistance;
    this.lastLap = s.lap;
    return out;
  }

  private matches(w: RaceCondition, s: BattleSnapshot, prevDistance: number | null): boolean {
    if (!matchesScene(w, this.ctx)) return false;
    if (w.event !== undefined && !s.events.includes(w.event)) return false;
    if (w.at !== undefined && !(prevDistance !== null && prevDistance < w.at && s.lapDistance >= w.at)) return false;
    if (w.lap !== undefined && w.lap !== s.lap) return false;
    if (w.position === 'ahead' && !s.ahead) return false;
    if (w.position === 'behind' && s.ahead) return false;
    return inRange(w.gap, s.gap) && inRange(w.speed, s.speedKmh) && inRange(w.elapsed, s.elapsed) && inRange(w.progress, s.progress);
  }
}

/** 抜いた・抜かれたを、前後の入れ替わりから見つける（並んでいる間に何度も出ないよう、差が margin [m] を超えてから） */
export class OvertakeWatcher {
  private ahead: boolean | null = null;

  constructor(private readonly margin = 2) {}

  update(signedGap: number): BattleEvent | null {
    if (Math.abs(signedGap) < this.margin) return null;
    const ahead = signedGap > 0;
    const was = this.ahead;
    this.ahead = ahead;
    if (was === null || was === ahead) return null;
    return ahead ? 'overtake' : 'overtaken';
  }
}

/** 字幕を出しておく時間 [s]（文字数に合わせる） */
/** 走っている間の字幕の1回分の長さの目安 [文字] */
export const MAX_LINE_CHARS = 24;

/**
 * 長いセリフを、走りながら読める長さに区切る（改行・文の終わり（。！？）・空白で区切り、短い文はまとめる）。
 * それでも長い文は読点（、）で区切る。
 */
export function splitLine(text: string, max = MAX_LINE_CHARS): string[] {
  const len = (s: string) => [...s].length;
  const pieces: string[] = [];
  for (const raw of text.split('\n')) {
    // 文の終わりの記号（続く ！！ や 」 も含む）か、全角・半角の空白の後ろで区切る
    for (const sentence of raw.match(/[^。！？!?…\s　]*(?:[。！？!?…]+[」』）)]*|[\s　]+|$)/g) ?? []) {
      const t = sentence.trim();
      if (!t) continue;
      if (len(t) <= max) pieces.push(t);
      else pieces.push(...(t.match(/[^、，,]+[、，,]?/g) ?? [t]).map((p) => p.trim()).filter(Boolean));
    }
  }
  // 続けても max に収まる短い文はまとめる
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && len(last) + 1 + len(p) <= max) out[out.length - 1] = `${last}${/[、，,]$/.test(last) ? '' : ' '}${p}`;
    else out.push(p);
  }
  return out.length ? out : [text];
}

export function lineDuration(text: string): number {
  return Math.min(10, Math.max(2.5, 1.4 + [...text].length * 0.12));
}
