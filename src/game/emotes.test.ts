import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_EMOTE_LENGTH } from '../net/protocol';
import { DEFAULT_EMOTE, loadEmote, saveEmote } from './emotes';

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

describe('emote', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the default line until one is saved', () => {
    stubStorage();
    expect(loadEmote()).toBe(DEFAULT_EMOTE);
    expect(saveEmote('  お先に！ ')).toBe('お先に！');
    expect(loadEmote()).toBe('お先に！');
  });

  it('cuts long lines and goes back to the default when cleared', () => {
    const map = stubStorage();
    expect([...saveEmote('あ'.repeat(40))]).toHaveLength(MAX_EMOTE_LENGTH);
    expect(saveEmote('   ')).toBe(DEFAULT_EMOTE);
    expect(map.has('car-game:emote')).toBe(false);
  });
});
