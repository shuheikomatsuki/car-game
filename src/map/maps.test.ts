import { describe, expect, it } from 'vitest';
import { MAPS, TITLE_MAPS } from './maps';

describe('TITLE_MAPS', () => {
  it('練習用のコースとサーキットを含まない', () => {
    const ids = TITLE_MAPS.map((m) => m.id);
    for (const id of ['town', 'school', 'circuit-gp']) expect(ids).not.toContain(id);
    expect(ids).toContain('shutoko-loop-2');
    expect(ids).toContain('pass-down');
  });

  it('どれも MAPS にある', () => {
    for (const m of TITLE_MAPS) expect(MAPS).toContain(m);
  });
});
