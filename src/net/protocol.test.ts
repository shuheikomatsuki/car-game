import { describe, expect, it } from 'vitest';
import { isRoomCode, normalizeRoomCode, parseClientMessage, randomRoomCode } from './protocol';

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
});
