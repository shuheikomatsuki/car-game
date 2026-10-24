import { describe, expect, it } from 'vitest';
import { isRoomCode, normalizeRoomCode, parseClientMessage, randomRoomCode, sanitizeName } from './protocol';

describe('protocol', () => {
  it('makes and checks room codes', () => {
    for (let i = 0; i < 20; i++) expect(isRoomCode(randomRoomCode())).toBe(true);
    expect(isRoomCode('ABC')).toBe(false);
    expect(isRoomCode('AB0D')).toBe(false);
    expect(normalizeRoomCode(' ab-cd ')).toBe('ABCD');
  });

  it('accepts well-formed messages only', () => {
    expect(parseClientMessage('{"t":"state","time":1,"s":[1,2,3,4,5,6]}')).toEqual({ t: 'state', time: 1, s: [1, 2, 3, 4, 5, 6] });
    expect(parseClientMessage('{"t":"state","time":1,"s":[1,2,3]}')).toBeNull();
    expect(parseClientMessage('{"t":"state","time":1,"s":[1,2,3,4,5,null]}')).toBeNull();
    expect(parseClientMessage('{"t":"map","map":1.7}')).toEqual({ t: 'map', map: 1 });
    expect(parseClientMessage('{"t":"unknown"}')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('x'.repeat(3000))).toBeNull();
  });

  it('checks horn, emote, lights and race messages', () => {
    expect(parseClientMessage('{"t":"state","time":1,"s":[1,2,3,4,5,6],"p":120.5}')).toEqual({ t: 'state', time: 1, s: [1, 2, 3, 4, 5, 6], p: 120.5 });
    expect(parseClientMessage('{"t":"state","time":1,"s":[1,2,3,4,5,6],"p":"x"}')).toBeNull();
    expect(parseClientMessage('{"t":"profile","lights":true}')).toEqual({ t: 'profile', lights: true });
    expect(parseClientMessage('{"t":"profile"}')).toBeNull();
    expect(parseClientMessage('{"t":"horn","on":true}')).toEqual({ t: 'horn', on: true });
    expect(parseClientMessage('{"t":"emote","e":3}')).toEqual({ t: 'emote', e: 3 });
    expect(parseClientMessage('{"t":"emote","e":99}')).toBeNull();
    expect(parseClientMessage('{"t":"raceOpen","settings":{"map":2,"time":"night","weather":"rain"}}')).toEqual({
      t: 'raceOpen',
      settings: { map: 2, time: 'night', weather: 'rain' },
    });
    expect(parseClientMessage('{"t":"raceOpen","settings":{"map":2,"time":"noon","weather":"rain"}}')).toBeNull();
    expect(parseClientMessage('{"t":"raceReady","ready":true,"car":"ae86"}')).toEqual({ t: 'raceReady', ready: true, car: 'ae86' });
    expect(parseClientMessage('{"t":"raceFinish","seq":1,"time":-3}')).toBeNull();
  });

  it('cuts names to 10 characters', () => {
    expect(sanitizeName('あいうえおかきくけこさしすせそ')).toBe('あいうえおかきくけこ');
    expect(sanitizeName('   ')).toBe('ゲスト');
  });
});
