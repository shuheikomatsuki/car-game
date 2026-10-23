import { describe, expect, it } from 'vitest';
import { EMOTES } from '../game/emotes';
import { EMOTE_COUNT } from '../net/protocol';
import { lapsDone, rankOnline, standingsWindow } from './onlineRace';

const e = (name: string, distance: number, total: number | null = null, isPlayer = false) => ({ name, color: 0, isPlayer, distance, total, laps: 0 });

describe('online race', () => {
  it('ranks finished players by time, then the rest by distance', () => {
    const list = rankOnline([e('a', 500), e('b', 900), e('c', 1200, 70.5), e('me', 700, null, true), e('d', 1200, 65)]);
    expect(list.map((r) => r.name)).toEqual(['d', 'c', 'b', 'me', 'a']);
  });

  it('shows the top three and me when I am further back', () => {
    const list = ['a', 'b', 'c', 'd', 'me', 'f'].map((n) => ({ name: n, isPlayer: n === 'me' }));
    expect(standingsWindow(list).map((r) => `${r.rank}:${r.entry.name}`)).toEqual(['1:a', '2:b', '3:c', '5:me']);
    const front = [{ name: 'me', isPlayer: true }, { name: 'x', isPlayer: false }];
    expect(standingsWindow(front).map((r) => r.rank)).toEqual([1, 2]);
  });

  it('counts finished laps from the distance', () => {
    expect(lapsDone(2500, 1000, true, 3)).toBe(2);
    expect(lapsDone(5000, 1000, true, 3)).toBe(3);
    expect(lapsDone(2500, 1000, false, 1)).toBe(0);
  });

  it('has as many emotes as the protocol allows', () => {
    expect(EMOTES).toHaveLength(EMOTE_COUNT);
    expect(EMOTES).toContain('俺のRについて来れるか！？');
  });
});
