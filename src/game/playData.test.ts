import { describe, expect, it } from 'vitest';
import { clearPlayData, isPlayDataKey } from './playData';

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe('play data', () => {
  it('removes records, ghosts, beaten rivals and ranking marks but keeps settings', () => {
    const s = memoryStorage({
      'car-game:time-attack:v1:秋名:ae86': '{}',
      'car-game:beaten-rivals': '[]',
      'car-game:uploaded:v1:x': '1',
      'car-game:my-entry:v1:x': '{}',
      'car-game:player-id': 'abc',
      'car-game:name': 'me',
      'car-game:muted': '0',
      'other-app': 'x',
    });
    expect(clearPlayData(s)).toBe(4);
    expect([...s.map.keys()].sort()).toEqual(['car-game:muted', 'car-game:name', 'car-game:player-id', 'other-app']);
  });

  it('tells play data keys from settings', () => {
    expect(isPlayDataKey('car-game:time-attack:v1:a:b')).toBe(true);
    expect(isPlayDataKey('car-game:bgm')).toBe(false);
  });

  it('does nothing without storage', () => {
    expect(clearPlayData(null)).toBe(0);
  });
});
