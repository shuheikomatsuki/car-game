import { describe, expect, it } from 'vitest';
import { type Command, isEmergency, parseCommand } from './commands';

const cases: [string, Command | null][] = [
  ['発進して', 'start'],
  ['発信して', 'start'],
  ['発振して', 'start'],
  ['発車して', 'start'],
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
  ['次を左', 'turnLeft'],
  ['その角を右', 'turnRight'],
  ['ひだり', 'goLeft'],
  ['ミギ', 'goRight'],
  ['右に曲がって', 'goRight'],
  ['右、いや左', 'goLeft'],
  ['今すぐ右', 'steerRight'],
  ['ここで左に曲がって', 'steerLeft'],
  ['ハンドル右に切って', 'steerRight'],
  ['道に戻って', 'returnToRoad'],
  ['道路に出て', 'returnToRoad'],
  ['そこじゃなくて、次を左！', 'correctLeft'],
  ['違う違う、次を右', 'correctRight'],
  ['まっすぐ行って', 'straight'],
  ['Uターンして', 'uturn'],
  ['ユーターン', 'uturn'],
  ['引き返して', 'uturn'],
  ['もっと飛ばして', 'faster'],
  ['右に寄って', 'shiftRight'],
  ['ちょっと左', 'shiftLeft'],
  ['もう少し右に寄せて', 'shiftRight'],
  ['車線に戻って', 'keepLane'],
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
