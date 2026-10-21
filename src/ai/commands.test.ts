import { describe, expect, it } from 'vitest';
import { type Command, isEmergency, parseCommand } from './commands';

const cases: [string, Command | null][] = [
  ['発進して', 'start'],
  ['しゅっぱつ！', 'start'],
  ['よし、行って', 'start'],
  ['もう少しスピードを上げて', 'faster'],
  ['もっと速く', 'faster'],
  ['ゆっくり走って', 'slower'],
  ['スピード落として', 'slower'],
  ['止まって！', 'stop'],
  ['ストップ', 'stop'],
  ['ブレーキ！', 'stop'],
  ['スピードアップ', 'faster'],
  ['スピードあげて', 'faster'],
  ['スピードを落として', 'slower'],
  ['とまれ', 'stop'],
  ['危ない！', 'danger'],
  ['あぶない', 'danger'],
  ['次の交差点を右に曲がって', 'turnRight'],
  ['ひだり', 'turnLeft'],
  ['ミギ', 'turnRight'],
  ['右、いや左', 'turnLeft'],
  ['そこじゃなくて、次を左！', 'correctLeft'],
  ['違う違う、次を右', 'correctRight'],
  ['まっすぐ行って', 'straight'],
  ['こんにちは', null],
  ['', null],
];

describe('parseCommand', () => {
  it.each(cases)('%s → %s', (text, expected) => {
    expect(parseCommand(text)).toBe(expected);
  });

  it('treats only stop and danger as emergencies', () => {
    expect(isEmergency('stop')).toBe(true);
    expect(isEmergency('danger')).toBe(true);
    expect(isEmergency('turnLeft')).toBe(false);
  });
});
