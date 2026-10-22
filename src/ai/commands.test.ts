import { describe, expect, it } from 'vitest';
import { type Command, isEmergency, parseCommand, parseCommandOptions } from './commands';

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
  ['道なりに走って', 'followRoad'],
  ['ハンドル戻して', 'straight'],
  ['3秒後に左に曲がって', 'goLeft'],
  ['30度右', 'goRight'],
  ['もっと左', 'shiftLeft'],
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

describe('parseCommandOptions', () => {
  it.each([
    ['3秒後に左に曲がって', { delaySeconds: 3 }],
    ['１．５秒たったら右', { delaySeconds: 1.5 }],
    ['五秒後に右', { delaySeconds: 5 }],
    ['十五秒後に止まって', { delaySeconds: 15 }],
    ['50メートル先で右', { distanceMeters: 50 }],
    ['30度右に切って', { angleDeg: 30 }],
    ['四十五度左', { angleDeg: 45 }],
    ['右に曲がって', {}],
  ])('%s', (text, expected) => {
    expect(parseCommandOptions(text)).toEqual(expected);
  });
});
