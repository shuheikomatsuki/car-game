/**
 * BGM。リポジトリ直下の bgm/ フォルダに置いた音声ファイルを、ビルド時に自動で曲の一覧にする。
 * ファイル名（拡張子と先頭の「01_」のような番号を除いたもの）がそのまま曲名になり、ファイル名の順に並ぶ。
 * 効果音（SoundSystem）とは別に、オン・オフと音量を設定できる。
 */

export interface BgmTrack {
  id: string;
  title: string;
  url: string;
}

/** 'off' は流さない、'shuffle' はランダムに次々流す。それ以外は曲の id（その曲を繰り返す） */
export type BgmChoice = string;

export const BGM_VOLUMES = [
  { id: 'low', label: '小', gain: 0.25 },
  { id: 'mid', label: '中', gain: 0.5 },
  { id: 'high', label: '大', gain: 0.85 },
] as const;

/** ファイルのパスから曲名を作る（'../../bgm/01_峠の朝.mp3' → '峠の朝'） */
export function trackTitle(path: string): string {
  const file = path.split('/').pop() ?? path;
  const base = file.replace(/\.[^.]+$/, '');
  const title = base.replace(/^\d+[\s_\-.]+/, '').replace(/_/g, ' ').trim();
  return title || base;
}

/** glob の結果（パス → URL）から、ファイル名の順に並んだ曲の一覧を作る */
export function buildTracks(files: Record<string, string>): BgmTrack[] {
  return Object.keys(files)
    .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))
    .map((path) => ({ id: path.split('/').pop() ?? path, title: trackTitle(path), url: files[path] }));
}

/** 設定で選べるもの（なし → 各曲 → シャッフル）。曲が2曲未満ならシャッフルは出さない */
export function bgmChoices(tracks: readonly BgmTrack[]): BgmChoice[] {
  return ['off', ...tracks.map((t) => t.id), ...(tracks.length >= 2 ? ['shuffle'] : [])];
}

/** 設定の次の値。今の値が一覧にない（曲を消した）ときは「なし」の次から */
export function nextBgmChoice(tracks: readonly BgmTrack[], current: BgmChoice): BgmChoice {
  const list = bgmChoices(tracks);
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

/** 保存されていた値を検証する（無い曲なら 'off'） */
export function validBgmChoice(tracks: readonly BgmTrack[], saved: string | null): BgmChoice {
  return saved && bgmChoices(tracks).includes(saved) ? saved : 'off';
}

/** シャッフルで次に流す曲（同じ曲が続かないようにする） */
export function shuffleNext(tracks: readonly BgmTrack[], previous: string | null, random = Math.random): BgmTrack | null {
  if (tracks.length === 0) return null;
  const pool = tracks.length > 1 ? tracks.filter((t) => t.id !== previous) : tracks;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

const CHOICE_KEY = 'car-game:bgm';
const VOLUME_KEY = 'car-game:bgm-volume';

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

export class BgmPlayer {
  private choice: BgmChoice;
  private volume: (typeof BGM_VOLUMES)[number];
  private audio: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private current: BgmTrack | null = null;
  private unlocked = false;

  constructor(readonly tracks: readonly BgmTrack[]) {
    this.choice = validBgmChoice(tracks, load(CHOICE_KEY));
    this.volume = BGM_VOLUMES.find((v) => v.id === load(VOLUME_KEY)) ?? BGM_VOLUMES[1];
    // 別のアプリに切り替えたら止め、戻ったら続きから流す
    document.addEventListener('visibilitychange', () => {
      if (!this.audio || !this.current) return;
      if (document.hidden) this.audio.pause();
      else void this.audio.play().catch(() => {});
    });
  }

  get choiceLabel(): string {
    if (this.choice === 'off') return 'なし';
    if (this.choice === 'shuffle') return 'シャッフル';
    return this.tracks.find((t) => t.id === this.choice)?.title ?? 'なし';
  }

  get volumeLabel(): string {
    return this.volume.label;
  }

  get isOn(): boolean {
    return this.choice !== 'off';
  }

  /**
   * ユーザー操作のイベント内で呼ぶ（ブラウザの制約で、それまでは流せない）。
   * ctx を渡すと Web Audio 経由で鳴らす（iPhone は audio 要素の volume を変えられないため）
   */
  start(ctx: AudioContext | null): void {
    if (this.unlocked) {
      if (this.audio && this.current && this.audio.paused && !document.hidden) void this.audio.play().catch(() => {});
      return;
    }
    this.unlocked = true;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      if (this.choice === 'shuffle') this.play(shuffleNext(this.tracks, this.current?.id ?? null));
    });
    if (ctx) {
      try {
        this.gain = ctx.createGain();
        ctx.createMediaElementSource(audio).connect(this.gain).connect(ctx.destination);
      } catch {
        this.gain = null;
      }
    }
    this.audio = audio;
    this.applyVolume();
    this.applyChoice();
  }

  /** 設定を次の値にする */
  cycle(): void {
    this.choice = nextBgmChoice(this.tracks, this.choice);
    save(CHOICE_KEY, this.choice);
    this.applyChoice();
  }

  cycleVolume(): void {
    const i = BGM_VOLUMES.indexOf(this.volume);
    this.volume = BGM_VOLUMES[(i + 1) % BGM_VOLUMES.length];
    save(VOLUME_KEY, this.volume.id);
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.gain) this.gain.gain.value = this.volume.gain;
    else if (this.audio) this.audio.volume = this.volume.gain;
  }

  private applyChoice(): void {
    if (this.choice === 'off') this.play(null);
    else if (this.choice === 'shuffle') this.play(shuffleNext(this.tracks, this.current?.id ?? null));
    else this.play(this.tracks.find((t) => t.id === this.choice) ?? null);
  }

  private play(track: BgmTrack | null): void {
    const audio = this.audio;
    this.current = track;
    if (!audio) return;
    if (!track) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    audio.loop = this.choice !== 'shuffle';
    audio.src = track.url;
    if (!document.hidden) void audio.play().catch(() => {});
  }
}

/** bgm/ フォルダの曲（ビルド時に集める） */
export const BGM_TRACKS: readonly BgmTrack[] = buildTracks(
  import.meta.glob('../../bgm/*.{mp3,m4a,aac,ogg,opus,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
);
