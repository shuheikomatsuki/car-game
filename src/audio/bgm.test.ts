import { describe, expect, it } from 'vitest';
import { bgmChoices, buildTracks, nextBgmChoice, shuffleNext, trackTitle, validBgmChoice } from './bgm';

const tracks = buildTracks({
  '../../bgm/10_last.mp3': '/assets/c.mp3',
  '../../bgm/2_峠の朝.mp3': '/assets/b.mp3',
  '../../bgm/01_night_run.m4a': '/assets/a.m4a',
});

describe('trackTitle', () => {
  it('拡張子と先頭の番号を取り、_ を空白にする', () => {
    expect(trackTitle('../../bgm/01_峠の朝.mp3')).toBe('峠の朝');
    expect(trackTitle('../../bgm/night_run.ogg')).toBe('night run');
    expect(trackTitle('../../bgm/2024.mp3')).toBe('2024');
  });
});

describe('buildTracks', () => {
  it('ファイル名の数字順に並べる', () => {
    expect(tracks.map((t) => t.title)).toEqual(['night run', '峠の朝', 'last']);
    expect(tracks[0]).toEqual({ id: '01_night_run.m4a', title: 'night run', url: '/assets/a.m4a' });
  });
});

describe('設定の切り替え', () => {
  it('なし → 各曲 → シャッフル → なし', () => {
    expect(bgmChoices(tracks)).toEqual(['off', '01_night_run.m4a', '2_峠の朝.mp3', '10_last.mp3', 'shuffle']);
    expect(nextBgmChoice(tracks, 'off')).toBe('01_night_run.m4a');
    expect(nextBgmChoice(tracks, 'shuffle')).toBe('off');
  });

  it('曲が1曲ならシャッフルは出さず、曲が無ければなしのまま', () => {
    expect(bgmChoices(tracks.slice(0, 1))).toEqual(['off', '01_night_run.m4a']);
    expect(nextBgmChoice([], 'off')).toBe('off');
  });

  it('保存されていた曲が消えていたらなしにする', () => {
    expect(validBgmChoice(tracks, '2_峠の朝.mp3')).toBe('2_峠の朝.mp3');
    expect(validBgmChoice(tracks, 'deleted.mp3')).toBe('off');
    expect(validBgmChoice(tracks, null)).toBe('off');
    expect(nextBgmChoice(tracks, 'deleted.mp3')).toBe('off');
  });
});

describe('shuffleNext', () => {
  it('同じ曲を続けて選ばない', () => {
    for (const r of [0, 0.5, 0.999]) expect(shuffleNext(tracks, '2_峠の朝.mp3', () => r)?.id).not.toBe('2_峠の朝.mp3');
  });

  it('1曲ならその曲、0曲なら null', () => {
    expect(shuffleNext(tracks.slice(0, 1), '01_night_run.m4a')?.id).toBe('01_night_run.m4a');
    expect(shuffleNext([], null)).toBeNull();
  });
});
