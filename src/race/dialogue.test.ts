import { describe, expect, it } from 'vitest';
import { type BattleContext, BattleDialogue, type BattleSnapshot, OvertakeWatcher, dialogueApplies, lineDuration, sceneLines } from './dialogue';
import { CHARACTERS, RIVAL_DIALOGUES } from './dialogueScript';
import { RIVALS } from './rivals';
import { VEHICLE_PRESETS } from '../sim/vehicle';

const ctx: BattleContext = {
  course: 'pass-down',
  homeCourse: 'pass-down',
  playerCar: 'ae86',
  rule: 'side',
  playerLeads: false,
  round: 1,
  weather: 'clear',
  time: 'night',
};

const snap = (s: Partial<BattleSnapshot>): BattleSnapshot => ({
  elapsed: 10,
  lap: 1,
  lapDistance: 0,
  ahead: false,
  gap: 20,
  speedKmh: 100,
  events: [],
  ...s,
});

const line = (text: string) => [{ who: 'takumi', text }];

describe('dialogueApplies', () => {
  it('はじめは得意なコースのときだけ', () => {
    expect(dialogueApplies({}, ctx)).toBe(true);
    expect(dialogueApplies({}, { ...ctx, course: 'circuit-gp' })).toBe(false);
    expect(dialogueApplies({ onlyHomeCourse: false }, { ...ctx, course: 'circuit-gp' })).toBe(true);
    expect(dialogueApplies(undefined, ctx)).toBe(false);
  });

  it('自分の車などの条件を見る', () => {
    expect(dialogueApplies({ when: { playerCar: 'ae86' } }, ctx)).toBe(true);
    expect(dialogueApplies({ when: { playerCar: ['fd3s', 'r34'] } }, ctx)).toBe(false);
    expect(dialogueApplies({ when: { time: 'night', weather: ['clear', 'fog'] } }, ctx)).toBe(true);
  });
});

describe('sceneLines', () => {
  it('条件に合う最初の場面を使う', () => {
    const scenes = [
      { when: { weather: 'rain' as const }, say: line('雨') },
      { when: { rule: 'suddenDeath' as const, playerLeads: true }, say: line('先行') },
      { say: line('ふつう') },
    ];
    expect(sceneLines(scenes, ctx)[0].text).toBe('ふつう');
    expect(sceneLines(scenes, { ...ctx, weather: 'rain' })[0].text).toBe('雨');
    expect(sceneLines(scenes, { ...ctx, rule: 'suddenDeath', playerLeads: true })[0].text).toBe('先行');
    expect(sceneLines(undefined, ctx)).toEqual([]);
  });
});

describe('BattleDialogue', () => {
  it('その場所を通ったときに1回だけ出す', () => {
    const d = new BattleDialogue([{ when: { at: 500 }, say: line('ここだ') }], ctx);
    expect(d.update(snap({ lapDistance: 490 }))).toEqual([]);
    expect(d.update(snap({ lapDistance: 501 }))[0].text).toBe('ここだ');
    expect(d.update(snap({ lapDistance: 510 }))).toEqual([]);
  });

  it('場所の条件は、同時にほかの条件も満たしているときだけ', () => {
    const d = new BattleDialogue([{ when: { at: 500, position: 'ahead', gap: { min: 30 } }, say: line('離した') }], ctx);
    expect(d.update(snap({ lapDistance: 490, ahead: true, gap: 10 }))).toEqual([]);
    expect(d.update(snap({ lapDistance: 505, ahead: true, gap: 10 }))).toEqual([]);
    const d2 = new BattleDialogue([{ when: { at: 500, position: 'ahead', gap: { min: 30 } }, say: line('離した') }], ctx);
    d2.update(snap({ lapDistance: 490 }));
    expect(d2.update(snap({ lapDistance: 505, ahead: true, gap: 40 }))).toHaveLength(1);
  });

  it('周回コースは周ごとに場所を数え、lap で周を選べる', () => {
    const d = new BattleDialogue([{ when: { at: 100, lap: 2 }, say: line('2周目') }], ctx);
    d.update(snap({ lapDistance: 90 }));
    expect(d.update(snap({ lapDistance: 110 }))).toEqual([]);
    // 周が変わった直後は前の距離と比べない（周の終わり→始まりで通ったことにしない）
    d.update(snap({ lap: 2, lapDistance: 2 }));
    expect(d.update(snap({ lap: 2, lapDistance: 101 }))).toHaveLength(1);
  });

  it('出来事のセリフ。repeat なら何度でも', () => {
    const d = new BattleDialogue(
      [
        { when: { event: 'overtaken' }, say: line('抜かれた') },
        { when: { event: 'crash' }, say: line('ぶつかった'), repeat: true },
      ],
      ctx,
    );
    expect(d.update(snap({ events: ['overtaken'] }))).toHaveLength(1);
    expect(d.update(snap({ events: ['overtaken'] }))).toEqual([]);
    expect(d.update(snap({ events: ['crash'] }))).toHaveLength(1);
    expect(d.update(snap({}))).toEqual([]);
    expect(d.update(snap({ events: ['crash'] }))).toHaveLength(1);
  });

  it('場所も出来事もない条件は、満たした瞬間に出す（repeat は満たさなくなってから再び満たしたとき）', () => {
    const d = new BattleDialogue([{ when: { speed: { min: 150 } }, say: line('速い'), repeat: true }], ctx);
    expect(d.update(snap({ speedKmh: 160 }))).toHaveLength(1);
    expect(d.update(snap({ speedKmh: 170 }))).toEqual([]);
    d.update(snap({ speedKmh: 120 }));
    expect(d.update(snap({ speedKmh: 155 }))).toHaveLength(1);
  });

  it('時間・後ろにいる・差の範囲', () => {
    const d = new BattleDialogue([{ when: { elapsed: { min: 30 }, position: 'behind', gap: { max: 10 } }, say: line('食らいつく') }], ctx);
    expect(d.update(snap({ elapsed: 20, gap: 5 }))).toEqual([]);
    expect(d.update(snap({ elapsed: 31, gap: 15 }))).toEqual([]);
    expect(d.update(snap({ elapsed: 32, gap: 5, ahead: true }))).toEqual([]);
    expect(d.update(snap({ elapsed: 33, gap: 5 }))).toHaveLength(1);
  });
});

describe('OvertakeWatcher', () => {
  it('前後が入れ替わったら抜いた・抜かれた（並んでいる間は数えない）', () => {
    const w = new OvertakeWatcher(2);
    expect(w.update(-10)).toBeNull();
    expect(w.update(1)).toBeNull();
    expect(w.update(3)).toBe('overtake');
    expect(w.update(-1)).toBeNull();
    expect(w.update(5)).toBeNull();
    expect(w.update(-3)).toBe('overtaken');
  });
});

describe('lineDuration', () => {
  it('長いセリフほど長く出す（2.5〜7秒）', () => {
    expect(lineDuration('あ')).toBe(2.5);
    expect(lineDuration('あ'.repeat(30))).toBeGreaterThan(lineDuration('あ'.repeat(10)));
    expect(lineDuration('あ'.repeat(200))).toBe(7);
  });
});

describe('dialogueScript', () => {
  it('書いたライバルと車の id が正しく、セリフが空でない', () => {
    const cars = new Set(VEHICLE_PRESETS.map((v) => v.id));
    for (const [id, d] of Object.entries(RIVAL_DIALOGUES)) {
      expect(RIVALS.some((r) => r.id === id), id).toBe(true);
      const scenes = [...(d.intro ?? []), ...(d.win ?? []), ...(d.lose ?? []), ...(d.draw ?? []), ...(d.race ?? [])];
      const conds = [d.when, ...scenes.map((s) => s.when)];
      for (const c of conds) {
        for (const car of [c?.playerCar ?? []].flat()) expect(cars.has(car), `${id}: ${car}`).toBe(true);
      }
      for (const s of scenes) for (const l of s.say) expect(l.text.trim(), `${id}: ${l.who}`).not.toBe('');
    }
    for (const c of Object.values(CHARACTERS)) expect(c.name).not.toBe('');
  });
});
