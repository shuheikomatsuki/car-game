import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, migrateSaveData, savedVersion } from './saveVersion';

function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe('save data version', () => {
  it('stamps the current version on data saved before versioning', () => {
    const s = memoryStorage({ 'car-game:name': 'shuhei' });
    expect(migrateSaveData(s)).toBe(0);
    expect(savedVersion(s)).toBe(SAVE_VERSION);
    expect(s.getItem('car-game:name')).toBe('shuhei');
    // 2回目は何もしない
    expect(migrateSaveData(s)).toBe(SAVE_VERSION);
  });

  it('runs each step from the saved version in order', () => {
    const s = memoryStorage({ 'car-game:save-version': '1', 'car-game:owned': 'old' });
    const ran: number[] = [];
    const steps = [
      () => ran.push(0),
      (st: Pick<Storage, 'setItem'>) => (ran.push(1), st.setItem('car-game:owned', '["ae86"]')),
      () => ran.push(2),
    ];
    expect(migrateSaveData(s, steps)).toBe(1);
    expect(ran).toEqual([1, 2]);
    expect(s.getItem('car-game:owned')).toBe('["ae86"]');
    expect(savedVersion(s)).toBe(3);
  });

  it('leaves data from a newer game alone', () => {
    const s = memoryStorage({ 'car-game:save-version': '9' });
    expect(migrateSaveData(s)).toBe(9);
    expect(savedVersion(s)).toBe(9);
  });
});
