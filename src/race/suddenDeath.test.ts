import { describe, expect, it } from 'vitest';
import { BREAKAWAY_DISTANCE, SuddenDeath, judgeRun } from './suddenDeath';

const running = (distance: number) => ({ distance, finishTime: null });
const finished = (distance: number, finishTime: number) => ({ distance, finishTime });

describe('judgeRun', () => {
  it('waits while the chaser stays close', () => {
    expect(judgeRun(running(500), running(480))).toBeNull();
  });

  it('gives the win to the leader who pulls far away', () => {
    expect(judgeRun(running(500), running(500 - BREAKAWAY_DISTANCE))).toBe('leadWins');
  });

  it('gives the win to the chaser who overtakes and finishes first', () => {
    expect(judgeRun(running(1990), finished(2000, 60))).toBe('chaseWins');
    expect(judgeRun(finished(2000, 60.5), finished(2000, 60.2))).toBe('chaseWins');
  });

  it('is a draw when the leader finishes first without a decisive gap', () => {
    expect(judgeRun(finished(2000, 60), running(1980))).toBe('draw');
  });
});

describe('SuddenDeath', () => {
  it('swaps the leader after a draw and decides the winner by role', () => {
    const battle = new SuddenDeath(true);
    // 1本目: 自分が先行、引き分け
    expect(battle.update(finished(2000, 60), running(1990))).toBe('draw');
    expect(battle.winner).toBeNull();
    // 決まった後は何度呼んでも結果を返さない
    expect(battle.update(finished(2000, 60), finished(2000, 61))).toBeNull();
    battle.nextRound();
    expect(battle.round).toBe(2);
    expect(battle.playerLeads).toBe(false);
    // 2本目: 自分が後追い。ライバル（先行）を抜いて先にゴール
    expect(battle.update(finished(2000, 59), running(1995))).toBe('chaseWins');
    expect(battle.winner).toBe('player');
  });

  it('lets the rival win by pulling away when the rival leads', () => {
    const battle = new SuddenDeath(false);
    expect(battle.gap(running(300), running(400))).toBe(100);
    expect(battle.update(running(300), running(400))).toBe('leadWins');
    expect(battle.winner).toBe('rival');
  });
});
