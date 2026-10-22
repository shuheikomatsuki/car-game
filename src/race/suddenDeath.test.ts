import { describe, expect, it } from 'vitest';
import { SAFE_SECONDS, SuddenDeath, judgeRun } from './suddenDeath';

const running = (distance: number) => ({ distance, finishTime: null });
const finished = (distance: number, finishTime: number) => ({ distance, finishTime });

describe('judgeRun', () => {
  it('does not decide in the middle of the run, however big the gap is', () => {
    expect(judgeRun(running(500), running(480), 30)).toBeNull();
    expect(judgeRun(running(900), running(300), 30)).toBeNull();
  });

  it('gives the win to the chaser who overtakes and finishes first', () => {
    expect(judgeRun(running(1990), finished(2000, 60), 60)).toBe('chaseWins');
    expect(judgeRun(finished(2000, 60.5), finished(2000, 60.2), 60.5)).toBe('chaseWins');
  });

  it('is a draw when the chaser finishes within the safe time after the leader', () => {
    expect(judgeRun(finished(2000, 60), running(1980), 60 + SAFE_SECONDS / 2)).toBeNull();
    expect(judgeRun(finished(2000, 60), finished(2000, 60 + SAFE_SECONDS - 0.01), 61)).toBe('draw');
  });

  it('gives the win to the leader when the chaser is later than the safe time', () => {
    expect(judgeRun(finished(2000, 60), running(1950), 60 + SAFE_SECONDS + 0.01)).toBe('leadWins');
    expect(judgeRun(finished(2000, 60), finished(2000, 60 + SAFE_SECONDS + 0.5), 62)).toBe('leadWins');
  });
});

describe('SuddenDeath', () => {
  it('swaps the leader after a draw and decides the winner by role', () => {
    const battle = new SuddenDeath(true);
    // 1本目: 自分が先行、後追いが続いてゴールして引き分け
    expect(battle.update(finished(2000, 60), finished(2000, 60.4), 60.4)).toBe('draw');
    expect(battle.winner).toBeNull();
    // 決まった後は何度呼んでも結果を返さない
    expect(battle.update(finished(2000, 60), finished(2000, 61), 61)).toBeNull();
    battle.nextRound();
    expect(battle.round).toBe(2);
    expect(battle.playerLeads).toBe(false);
    // 2本目: 自分が後追い。ライバル（先行）を抜いて先にゴール
    expect(battle.update(finished(2000, 59), running(1995), 59)).toBe('chaseWins');
    expect(battle.winner).toBe('player');
  });

  it('lets the rival win by finishing well ahead when the rival leads', () => {
    const battle = new SuddenDeath(false);
    expect(battle.gap(running(300), running(400))).toBe(100);
    expect(battle.update(running(1900), finished(2000, 60), 60.5)).toBeNull();
    expect(battle.update(running(1950), finished(2000, 60), 61.5)).toBe('leadWins');
    expect(battle.winner).toBe('rival');
  });
});
